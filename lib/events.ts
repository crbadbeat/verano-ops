import type { ShowEventStatus, ShowCostType } from "@prisma/client";

// -----------------------------------------------------------------------------
// Pure PGI event helpers (no DB) — labels, money, cost roll-ups and date-span
// formatting for the show tracker. Safe in client + server code.
// -----------------------------------------------------------------------------

export const EVENT_STATUS_LABEL: Record<ShowEventStatus, string> = {
  PLANNED: "Planned",
  CONFIRMED: "Confirmed",
  ACTIVE: "Active",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

export const EVENT_STATUS_ORDER: ShowEventStatus[] = [
  "PLANNED",
  "CONFIRMED",
  "ACTIVE",
  "COMPLETED",
  "CANCELLED",
];

export const COST_TYPE_LABEL: Record<ShowCostType, string> = {
  BOOTH: "Booth",
  ELECTRICITY: "Electricity",
  INTERNET: "Internet",
  SETUP: "Setup",
  TRAVEL: "Travel",
  LODGING: "Lodging",
  FLIGHTS: "Flights",
  PERDIEM: "Per diem",
  FREIGHT: "Freight / shipping",
  MARKETING: "Marketing",
  OTHER: "Other",
};

export const COST_TYPE_ORDER: ShowCostType[] = [
  "BOOTH",
  "ELECTRICITY",
  "INTERNET",
  "SETUP",
  "TRAVEL",
  "LODGING",
  "FLIGHTS",
  "PERDIEM",
  "FREIGHT",
  "MARKETING",
  "OTHER",
];

export function usd(cents: number | null | undefined): string {
  if (cents == null) return "—";
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

/** Sum budget + actual across cost lines (nulls treated as 0). */
export function costTotals(
  costs: { budgetCents: number | null; actualCents: number | null }[]
): { budget: number; actual: number } {
  return costs.reduce(
    (acc, c) => ({ budget: acc.budget + (c.budgetCents ?? 0), actual: acc.actual + (c.actualCents ?? 0) }),
    { budget: 0, actual: 0 }
  );
}

/** Earliest start and latest end across a show's date spans. */
export function eventDateRange(
  dates: { startDate: Date; endDate: Date }[]
): { first: Date | null; last: Date | null } {
  if (dates.length === 0) return { first: null, last: null };
  let first = dates[0].startDate;
  let last = dates[0].endDate;
  for (const d of dates) {
    if (d.startDate < first) first = d.startDate;
    if (d.endDate > last) last = d.endDate;
  }
  return { first, last };
}

function fmt(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/** "Mar 6, 2026" or "Mar 6 – 9, 2026" (compact when same month/year). */
export function formatDateSpan(start: Date, end: Date): string {
  if (start.getTime() === end.getTime()) return fmt(start);
  const sameYear = start.getUTCFullYear() === end.getUTCFullYear();
  const sameMonth = sameYear && start.getUTCMonth() === end.getUTCMonth();
  if (sameMonth) {
    const m = start.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });
    return `${m} ${start.getUTCDate()} – ${end.getUTCDate()}, ${start.getUTCFullYear()}`;
  }
  return `${fmt(start)} – ${fmt(end)}`;
}
