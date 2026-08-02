import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { geocode, recentDailyWeather } from "@/lib/weather";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// -----------------------------------------------------------------------------
// Daily weather capture. For every show that ran in the last week, snapshot each
// show-day's observed weather (Open-Meteo) into ShowWeatherDay so we can compare
// year-over-year whether weather moved the needle. Geocodes any venue that isn't
// yet located. Idempotent (upsert on eventId+date). Vercel Cron (see vercel.json)
// with the CRON_SECRET bearer; also callable by hand with the same header.
// -----------------------------------------------------------------------------

const DAY = 86_400_000;
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

async function run(req: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ ok: false, error: "CRON_SECRET is not configured on the server." }, { status: 500 });
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const windowStart = new Date(today.getTime() - 7 * DAY);

  const shows = await prisma.showEvent.findMany({
    where: {
      status: { not: "CANCELLED" },
      dates: { some: { startDate: { lte: today }, endDate: { gte: windowStart } } },
    },
    select: {
      id: true, city: true, state: true, latitude: true, longitude: true,
      dates: { select: { startDate: true, endDate: true } },
    },
  });

  let geocoded = 0;
  let captured = 0;
  let skipped = 0;

  for (const show of shows) {
    let lat = show.latitude;
    let lng = show.longitude;

    // Geocode the venue if we don't have coordinates yet.
    if ((lat == null || lng == null) && show.city) {
      const hit = await geocode(show.city, show.state);
      if (hit) {
        lat = hit.lat;
        lng = hit.lng;
        await prisma.showEvent.update({
          where: { id: show.id },
          data: { latitude: lat, longitude: lng, weatherGeocodedAt: new Date() },
        });
        geocoded++;
      }
    }
    if (lat == null || lng == null) {
      skipped++;
      continue;
    }

    const wx = await recentDailyWeather(lat, lng);
    if (wx.size === 0) {
      skipped++;
      continue;
    }

    // The set of show-days inside the capture window.
    const days = new Set<string>();
    for (const span of show.dates) {
      const from = new Date(Math.max(span.startDate.getTime(), windowStart.getTime()));
      const to = new Date(Math.min(span.endDate.getTime(), today.getTime()));
      for (let t = from.getTime(); t <= to.getTime(); t += DAY) days.add(isoDay(new Date(t)));
    }

    for (const dayIso of days) {
      const d = wx.get(dayIso);
      if (!d) continue;
      const date = new Date(`${dayIso}T00:00:00.000Z`);
      await prisma.showWeatherDay.upsert({
        where: { eventId_date: { eventId: show.id, date } },
        create: {
          eventId: show.id, date,
          tempMaxF: d.tempMaxF, tempMinF: d.tempMinF, precipitationIn: d.precipitationIn,
          windMph: d.windMph, weatherCode: d.weatherCode, source: "forecast",
        },
        update: {
          tempMaxF: d.tempMaxF, tempMinF: d.tempMinF, precipitationIn: d.precipitationIn,
          windMph: d.windMph, weatherCode: d.weatherCode, source: "forecast",
        },
      });
      captured++;
    }
  }

  return NextResponse.json({ ok: true, shows: shows.length, geocoded, captured, skipped }, { status: 200 });
}

export async function GET(req: Request): Promise<Response> {
  return run(req);
}
export async function POST(req: Request): Promise<Response> {
  return run(req);
}
