// Pure calendar helpers (no DB, no React) — UTC date math + week lane layout for
// the month calendar's multi-day spanning bars. Unit-tested in calendar.test.ts.

export const DAY_MS = 86_400_000;

export interface Span {
  start: string; // yyyy-mm-dd (UTC)
  end: string; // yyyy-mm-dd (UTC), inclusive
}

export const parseISO = (s: string): Date => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};
export const toISO = (d: Date): string => d.toISOString().slice(0, 10);
export const addDays = (d: Date, n: number): Date => new Date(d.getTime() + n * DAY_MS);
// Monday-first weeks (so a week ends on Sunday — most shows close on a Sunday).
export const startOfWeek = (d: Date): Date => addDays(d, -((d.getUTCDay() + 6) % 7));
export const startOfMonth = (d: Date): Date =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));

/** Number of days in the month `offsetMonths` away from `d`. */
export const daysInMonth = (d: Date, offsetMonths: number): number =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + offsetMonths + 1, 0)).getUTCDate();

/** True if any of the item's spans covers the given UTC-midnight day. */
export function coversDay(spans: Span[], dayMs: number): boolean {
  return spans.some((s) => parseISO(s.start).getTime() <= dayMs && parseISO(s.end).getTime() >= dayMs);
}

/** Earliest span start (ms) across an item, or null. */
export function firstStartMs(spans: Span[]): number | null {
  let min: number | null = null;
  for (const s of spans) {
    const t = parseISO(s.start).getTime();
    if (min == null || t < min) min = t;
  }
  return min;
}
/** Latest span end (ms) across an item, or null. */
export function lastEndMs(spans: Span[]): number | null {
  let max: number | null = null;
  for (const s of spans) {
    const t = parseISO(s.end).getTime();
    if (max == null || t > max) max = t;
  }
  return max;
}

export interface LaneSeg<T> {
  item: T;
  col: number; // 0-6 (Sun-Sat) where the bar starts in this week
  span: number; // number of day-columns the bar covers within the week
  lane: number; // 0-based vertical lane (stacked bars)
  startMs: number;
}

/**
 * Lay out every item's overlap with the [weekStart, weekStart+6] week into
 * non-overlapping horizontal lanes. Items are clamped to the week edges, sorted
 * by start (longer first on ties), and greedily placed in the first free lane.
 */
export function layoutWeek<T extends { spans: Span[] }>(items: T[], weekStart: Date): LaneSeg<T>[] {
  const weekStartMs = weekStart.getTime();
  const weekEndMs = addDays(weekStart, 6).getTime();
  const segs: LaneSeg<T>[] = [];
  for (const item of items) {
    for (const span of item.spans) {
      const ss = parseISO(span.start).getTime();
      const se = parseISO(span.end).getTime();
      if (se < weekStartMs || ss > weekEndMs) continue;
      const segStartMs = Math.max(ss, weekStartMs);
      const segEndMs = Math.min(se, weekEndMs);
      segs.push({
        item,
        col: Math.round((segStartMs - weekStartMs) / DAY_MS),
        span: Math.round((segEndMs - segStartMs) / DAY_MS) + 1,
        lane: 0,
        startMs: segStartMs,
      });
    }
  }
  segs.sort((a, b) => a.startMs - b.startMs || b.span - a.span);
  const lanes: LaneSeg<T>[][] = [];
  for (const seg of segs) {
    let placed = false;
    for (let li = 0; li < lanes.length; li++) {
      const conflict = lanes[li].some((x) => !(seg.col + seg.span <= x.col || x.col + x.span <= seg.col));
      if (!conflict) {
        lanes[li].push(seg);
        seg.lane = li;
        placed = true;
        break;
      }
    }
    if (!placed) {
      seg.lane = lanes.length;
      lanes.push([seg]);
    }
  }
  return segs;
}
