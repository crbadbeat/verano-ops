import "server-only";

// -----------------------------------------------------------------------------
// Weather via Open-Meteo — free, no API key, and it covers everything we need:
// geocoding (city/state → lat/lng), current conditions (the show-card chip), and
// a daily archive/forecast (the cron snapshots each show-day for year-over-year
// analysis). All fetchers fail soft (return null/empty) so a weather outage never
// breaks a page. Docs: https://open-meteo.com/en/docs
// -----------------------------------------------------------------------------

const GEO = "https://geocoding-api.open-meteo.com/v1/search";
const FORECAST = "https://api.open-meteo.com/v1/forecast";

/** WMO weather code → a short label + an emoji for the UI. */
export function weatherInfo(code: number | null | undefined): { label: string; emoji: string } {
  if (code == null) return { label: "—", emoji: "❓" };
  if (code === 0) return { label: "Clear", emoji: "☀️" };
  if (code === 1) return { label: "Mostly clear", emoji: "🌤️" };
  if (code === 2) return { label: "Partly cloudy", emoji: "⛅" };
  if (code === 3) return { label: "Overcast", emoji: "☁️" };
  if (code === 45 || code === 48) return { label: "Fog", emoji: "🌫️" };
  if (code >= 51 && code <= 57) return { label: "Drizzle", emoji: "🌦️" };
  if (code >= 61 && code <= 67) return { label: "Rain", emoji: "🌧️" };
  if (code >= 71 && code <= 77) return { label: "Snow", emoji: "🌨️" };
  if (code >= 80 && code <= 82) return { label: "Showers", emoji: "🌦️" };
  if (code === 85 || code === 86) return { label: "Snow showers", emoji: "🌨️" };
  if (code === 95) return { label: "Thunderstorm", emoji: "⛈️" };
  if (code === 96 || code === 99) return { label: "Thunderstorm", emoji: "⛈️" };
  return { label: "—", emoji: "🌡️" };
}

export interface GeoResult { lat: number; lng: number; name: string }

/** City (+ optional state) → coordinates. Prefers a US match in the given state. */
export async function geocode(city: string, state?: string | null): Promise<GeoResult | null> {
  const q = city.trim();
  if (!q) return null;
  try {
    const url = `${GEO}?name=${encodeURIComponent(q)}&count=10&language=en&format=json`;
    const res = await fetch(url, { next: { revalidate: 86_400 } });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      results?: { latitude: number; longitude: number; name: string; admin1?: string; country_code?: string }[];
    };
    const results = data.results ?? [];
    if (results.length === 0) return null;
    const st = state?.trim().toLowerCase();
    const scored = results
      .map((r) => {
        let score = 0;
        if (r.country_code === "US") score += 2;
        if (st && r.admin1 && r.admin1.toLowerCase().includes(st)) score += 3;
        return { r, score };
      })
      .sort((a, b) => b.score - a.score);
    const best = scored[0].r;
    return { lat: best.latitude, lng: best.longitude, name: [best.name, best.admin1].filter(Boolean).join(", ") };
  } catch {
    return null;
  }
}

export interface CurrentWeather { tempF: number; windMph: number; code: number; label: string; emoji: string }

/** Current conditions at a point. Cached ~30 min so the TV's 20s refresh + many
 *  show cards don't hammer the API. */
export async function currentWeather(lat: number, lng: number): Promise<CurrentWeather | null> {
  try {
    const url = `${FORECAST}?latitude=${lat}&longitude=${lng}&current=temperature_2m,weather_code,wind_speed_10m&temperature_unit=fahrenheit&wind_speed_unit=mph`;
    const res = await fetch(url, { next: { revalidate: 1800 } });
    if (!res.ok) return null;
    const data = (await res.json()) as { current?: { temperature_2m: number; weather_code: number; wind_speed_10m: number } };
    const c = data.current;
    if (!c) return null;
    const info = weatherInfo(c.weather_code);
    return { tempF: Math.round(c.temperature_2m), windMph: Math.round(c.wind_speed_10m), code: c.weather_code, ...info };
  } catch {
    return null;
  }
}

export interface DailyWeather {
  date: string; // yyyy-mm-dd
  tempMaxF: number | null;
  tempMinF: number | null;
  precipitationIn: number | null;
  windMph: number | null;
  weatherCode: number | null;
}

/** Daily weather for the last ~7 days at a point (keyed by yyyy-mm-dd) — the cron
 *  reads recent show-days out of this. Fresh (no cache) since the cron owns it. */
export async function recentDailyWeather(lat: number, lng: number): Promise<Map<string, DailyWeather>> {
  const out = new Map<string, DailyWeather>();
  try {
    const url =
      `${FORECAST}?latitude=${lat}&longitude=${lng}` +
      `&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,weather_code,wind_speed_10m_max` +
      `&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch&timezone=auto&past_days=7&forecast_days=1`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return out;
    const d = (await res.json()) as {
      daily?: {
        time: string[];
        temperature_2m_max: (number | null)[];
        temperature_2m_min: (number | null)[];
        precipitation_sum: (number | null)[];
        weather_code: (number | null)[];
        wind_speed_10m_max: (number | null)[];
      };
    };
    const day = d.daily;
    if (!day) return out;
    for (let i = 0; i < day.time.length; i++) {
      out.set(day.time[i], {
        date: day.time[i],
        tempMaxF: round(day.temperature_2m_max[i]),
        tempMinF: round(day.temperature_2m_min[i]),
        precipitationIn: round2(day.precipitation_sum[i]),
        windMph: round(day.wind_speed_10m_max[i]),
        weatherCode: day.weather_code[i] ?? null,
      });
    }
    return out;
  } catch {
    return out;
  }
}

/** Daily forecast for an explicit date range (keyed by yyyy-mm-dd). Open-Meteo's
 *  forecast serves ~92 days back to ~16 days ahead; a range outside that returns
 *  empty (fail-soft). Used for the show-days projection on the show view page. */
export async function dailyForecast(
  lat: number,
  lng: number,
  startIso: string,
  endIso: string
): Promise<Map<string, DailyWeather>> {
  const out = new Map<string, DailyWeather>();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startIso) || !/^\d{4}-\d{2}-\d{2}$/.test(endIso)) return out;
  try {
    const url =
      `${FORECAST}?latitude=${lat}&longitude=${lng}` +
      `&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,weather_code,wind_speed_10m_max` +
      `&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch&timezone=auto` +
      `&start_date=${startIso}&end_date=${endIso}`;
    const res = await fetch(url, { next: { revalidate: 3600 } });
    if (!res.ok) return out;
    const d = (await res.json()) as {
      daily?: {
        time: string[];
        temperature_2m_max: (number | null)[];
        temperature_2m_min: (number | null)[];
        precipitation_sum: (number | null)[];
        weather_code: (number | null)[];
        wind_speed_10m_max: (number | null)[];
      };
    };
    const day = d.daily;
    if (!day) return out;
    for (let i = 0; i < day.time.length; i++) {
      out.set(day.time[i], {
        date: day.time[i],
        tempMaxF: round(day.temperature_2m_max[i]),
        tempMinF: round(day.temperature_2m_min[i]),
        precipitationIn: round2(day.precipitation_sum[i]),
        windMph: round(day.wind_speed_10m_max[i]),
        weatherCode: day.weather_code[i] ?? null,
      });
    }
    return out;
  } catch {
    return out;
  }
}

const round = (n: number | null | undefined) => (n == null ? null : Math.round(n));
const round2 = (n: number | null | undefined) => (n == null ? null : Math.round(n * 100) / 100);
