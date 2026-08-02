// Pure reporting date-range helpers (no DB) — unit-tested in range.test.ts.
// All arithmetic is UTC, matching the rest of the app (@db.Date, lib/glass.ts,
// lib/scheduling.ts), so a window never drifts a day across the local offset.
//
// A range is [from, toExclusive): `from` is the first included UTC midnight and
// `toExclusive` is the midnight AFTER the last included day, so a Prisma filter
// is simply `{ createdAt: { gte: from, lt: toExclusive } }` and "today" is always
// included.

export type RangePreset = "week" | "mtd" | "d7" | "d30" | "d90" | "ytd" | "py" | "all" | "tm";

// The earliest date the sales history reaches (the historical backfill starts at
// 2024). "All time" floors here rather than at epoch so the window is finite and
// the monthly trend has a sane number of buckets.
const ALL_TIME_FLOOR = new Date(Date.UTC(2024, 0, 1));

export interface DateRange {
  from: Date; // inclusive, UTC midnight
  toExclusive: Date; // exclusive, UTC midnight (day after the last included day)
  fromIso: string; // yyyy-mm-dd of the first day
  toIso: string; // yyyy-mm-dd of the last INCLUDED day (for display + links)
  preset: RangePreset | "custom";
  label: string;
}

export const RANGE_PRESETS: RangePreset[] = [
  "week",
  "mtd",
  "d7",
  "d30",
  "d90",
  "ytd",
  "py",
  "all",
  "tm",
];

export const PRESET_LABEL: Record<RangePreset, string> = {
  week: "This week",
  mtd: "Month to date",
  d7: "Last 7 days",
  d30: "Last 30 days",
  d90: "Last 90 days",
  ytd: "Year to date",
  py: "Prior year",
  all: "All time",
  tm: "This month",
};

/** yyyy-mm-dd for a UTC date (matches how @db.Date values render). */
export function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function addUtcDays(date: Date, days: number): Date {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function parseIsoDay(value: string | undefined | null): Date | null {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  const date = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return Number.isNaN(date.getTime()) ? null : date;
}

function isPreset(value: string | undefined | null): value is RangePreset {
  return !!value && (RANGE_PRESETS as string[]).includes(value);
}

/** The window for a named preset, relative to `now` (Sunday-first weeks). */
export function presetRange(preset: RangePreset, now: Date): DateRange {
  const today = startOfUtcDay(now);
  const toExclusive = addUtcDays(today, 1);
  const build = (from: Date): DateRange => ({
    from,
    toExclusive,
    fromIso: isoDate(from),
    toIso: isoDate(today),
    preset,
    label: PRESET_LABEL[preset],
  });
  // For year-scale windows whose end is NOT today (e.g. a full prior year).
  const buildTo = (from: Date, lastIncluded: Date): DateRange => ({
    from,
    toExclusive: addUtcDays(lastIncluded, 1),
    fromIso: isoDate(from),
    toIso: isoDate(lastIncluded),
    preset,
    label: PRESET_LABEL[preset],
  });
  const year = today.getUTCFullYear();
  switch (preset) {
    case "week":
      return build(addUtcDays(today, -today.getUTCDay())); // back to Sunday
    case "mtd":
      return build(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)));
    case "d7":
      return build(addUtcDays(today, -6));
    case "d30":
      return build(addUtcDays(today, -29));
    case "d90":
      return build(addUtcDays(today, -89));
    case "ytd":
      return build(new Date(Date.UTC(year, 0, 1)));
    case "py":
      return buildTo(
        new Date(Date.UTC(year - 1, 0, 1)),
        new Date(Date.UTC(year - 1, 11, 31))
      );
    case "all":
      return build(ALL_TIME_FLOOR);
    case "tm":
      return buildTo(
        new Date(Date.UTC(year, today.getUTCMonth(), 1)),
        new Date(Date.UTC(year, today.getUTCMonth() + 1, 0))
      );
  }
}

/**
 * Resolve a range from query params. An explicit, well-formed `from`+`to` pair
 * (yyyy-mm-dd, from <= to) wins; otherwise the named preset; otherwise the
 * default (month to date). `to` is the last INCLUDED day.
 */
export function parseRange(
  params: { from?: string | null; to?: string | null; preset?: string | null },
  now: Date
): DateRange {
  const from = parseIsoDay(params.from);
  const to = parseIsoDay(params.to);
  if (from && to && from.getTime() <= to.getTime()) {
    return {
      from,
      toExclusive: addUtcDays(to, 1),
      fromIso: isoDate(from),
      toIso: isoDate(to),
      preset: "custom",
      label: `${isoDate(from)} – ${isoDate(to)}`,
    };
  }
  return presetRange(isPreset(params.preset) ? params.preset : "mtd", now);
}

/** Number of whole days in a range — for "N per day" averages. */
export function rangeDays(range: DateRange): number {
  const ms = range.toExclusive.getTime() - range.from.getTime();
  return Math.max(1, Math.round(ms / 86_400_000));
}

/** Every yyyy-mm-dd in [from, toExclusive) — for zero-filled daily trend series. */
export function eachDay(range: DateRange): string[] {
  const days: string[] = [];
  const cursor = new Date(range.from.getTime());
  while (cursor.getTime() < range.toExclusive.getTime()) {
    days.push(isoDate(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

/** yyyy-mm bucket key for a UTC date — the month a sale falls in. */
export function monthKey(date: Date): string {
  return isoDate(date).slice(0, 7);
}

/**
 * Every yyyy-mm month touched by [from, toExclusive) — for a zero-filled monthly
 * trend across a year-scale window (daily bars are unreadable over years).
 */
export function eachMonth(range: DateRange): string[] {
  const months: string[] = [];
  const cursor = new Date(Date.UTC(range.from.getUTCFullYear(), range.from.getUTCMonth(), 1));
  while (cursor.getTime() < range.toExclusive.getTime()) {
    months.push(monthKey(cursor));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return months;
}

/** "2026-03" -> "Mar '26" for compact trend labels. */
export function monthLabel(key: string): string {
  const [y, m] = key.split("-");
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const idx = Number(m) - 1;
  return `${names[idx] ?? m} '${y.slice(2)}`;
}
