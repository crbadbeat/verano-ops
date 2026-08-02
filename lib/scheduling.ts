// Pure scheduling helpers (no DB) — unit-tested in lib/scheduling.test.ts.
// Like lib/glass.ts, all date arithmetic is UTC so it lines up with Prisma
// `@db.Date` values (stored without a time zone) and the calendar never drifts a
// day across the local offset.

import { subtractBusinessDays } from "./glass";

// -----------------------------------------------------------------------------
// Calendar grid — powers the month view on /scheduling.
// -----------------------------------------------------------------------------

export interface CalendarCell {
  date: Date; // UTC midnight
  iso: string; // yyyy-mm-dd
  inMonth: boolean; // false for the padding days from the adjacent months
}
export type CalendarWeek = CalendarCell[]; // always length 7, Sunday-first

/** yyyy-mm-dd for a UTC date (matches how @db.Date values render). */
export function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * A Sunday-first month grid: whole weeks covering `month0` (0 = January),
 * padded with the leading/trailing days of the neighbouring months so every row
 * has 7 cells. Sunday-first matches lib/glass.ts `isWeekend` (Sunday = 0).
 */
export function buildMonthGrid(year: number, month0: number): CalendarWeek[] {
  const first = new Date(Date.UTC(year, month0, 1));
  const leading = first.getUTCDay(); // 0 = Sunday
  const daysInMonth = new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
  const rows = Math.ceil((leading + daysInMonth) / 7);
  const start = new Date(Date.UTC(year, month0, 1 - leading)); // the Sunday on/before the 1st

  const weeks: CalendarWeek[] = [];
  for (let w = 0; w < rows; w++) {
    const week: CalendarCell[] = [];
    for (let d = 0; d < 7; d++) {
      const cell = new Date(start.getTime());
      cell.setUTCDate(start.getUTCDate() + w * 7 + d);
      week.push({ date: cell, iso: isoDate(cell), inMonth: cell.getUTCMonth() === month0 });
    }
    weeks.push(week);
  }
  return weeks;
}

/** Move `delta` months from (year, month0), rolling the year over correctly. */
export function shiftMonth(
  year: number,
  month0: number,
  delta: number,
): { year: number; month0: number } {
  const base = new Date(Date.UTC(year, month0 + delta, 1));
  return { year: base.getUTCFullYear(), month0: base.getUTCMonth() };
}

/** Parse a `?month=yyyy-mm` query value; null if absent or malformed. */
export function parseMonth(param: string | undefined | null): { year: number; month0: number } | null {
  if (!param) return null;
  const m = /^(\d{4})-(\d{2})$/.exec(param);
  if (!m) return null;
  const year = Number(m[1]);
  const month1 = Number(m[2]);
  if (month1 < 1 || month1 > 12) return null;
  return { year, month0: month1 - 1 };
}

/** The `yyyy-mm` string for a (year, month0), for building month links. */
export function monthParam(year: number, month0: number): string {
  return `${year}-${String(month0 + 1).padStart(2, "0")}`;
}

// -----------------------------------------------------------------------------
// Staging + availability.
// -----------------------------------------------------------------------------

/**
 * When a trip's goods must be staged: the business day before the load date.
 * (Glass due dates use 2 business days — see lib/glass.ts `dueDateForLoadDate`.)
 */
export function stagingDateForLoadDate(loadDate: Date): Date {
  return subtractBusinessDays(loadDate, 1);
}

export interface PickLineInput {
  productId: string; // only resolved lines can be checked against on-hand
  sku: string | null;
  label: string;
  qty: number;
}

export interface Shortfall {
  productId: string;
  sku: string | null;
  label: string;
  needed: number; // total qty this order needs of the product
  onHand: number; // derived on-hand at check time
  short: number; // needed - onHand (always > 0 here)
}

/**
 * A point-in-time availability check for one order's pickable lines against
 * derived on-hand. Deliberately does NOT reserve or account for other scheduled
 * orders — it drives a warning, not a hold (the module writes no reservations).
 * Lines for the same product are summed first.
 */
export function computeShortfalls(lines: PickLineInput[], onHand: Map<string, number>): Shortfall[] {
  const byProduct = new Map<string, PickLineInput>();
  for (const l of lines) {
    const cur = byProduct.get(l.productId);
    if (cur) cur.qty += l.qty;
    else byProduct.set(l.productId, { ...l });
  }

  const shortfalls: Shortfall[] = [];
  for (const [productId, agg] of byProduct) {
    const oh = onHand.get(productId) ?? 0;
    if (agg.qty > oh) {
      shortfalls.push({
        productId,
        sku: agg.sku,
        label: agg.label,
        needed: agg.qty,
        onHand: oh,
        short: agg.qty - oh,
      });
    }
  }
  return shortfalls;
}

/** Whether scheduling this order requires the CSR to record a reason. */
export function requiresNote(shortfalls: Shortfall[]): boolean {
  return shortfalls.length > 0;
}
