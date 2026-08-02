import type { SalesLevel, SeparationType, Division } from "@prisma/client";

// -----------------------------------------------------------------------------
// Pure employee helpers (no DB) so they are safe in client + server code. The
// person record is the first-class Employee; these format it and encode the two
// business rules that ride on it: the sales hierarchy labels and the commission
// continuation window after separation.
// -----------------------------------------------------------------------------

export const SALES_LEVEL_LABEL: Record<SalesLevel, string> = {
  REP: "Sales Rep",
  GTL: "GTL — Showroom Manager",
  REGIONAL: "Regional",
  VP: "VP",
};

export const SEPARATION_LABEL: Record<SeparationType, string> = {
  TERMINATED: "Terminated",
  QUIT_WITH_NOTICE: "Quit — with notice",
  QUIT_NO_NOTICE: "Quit — no notice",
};

export const DIVISION_LABEL: Record<Division, string> = {
  PGI: "Verano International — Warehouse & Home Shows",
  PGD: "Verano Direct — Showrooms",
};

/** Best display name: the `preferredName` override if set, else the legal `name`,
 *  else first+last, else a dash. The override lets two people with an identical
 *  legal name (a Jr./Sr. pair) be told apart without changing the payroll name. */
export function employeeName(e: {
  preferredName?: string | null;
  name?: string | null;
  firstName?: string | null;
  lastName?: string | null;
}): string {
  const p = (e.preferredName ?? "").trim();
  if (p) return p;
  const n = (e.name ?? "").trim();
  if (n) return n;
  const fl = [e.firstName, e.lastName].map((s) => (s ?? "").trim()).filter(Boolean).join(" ");
  return fl || "—";
}

/**
 * The last date a separated employee still earns commissions, or null while they
 * are still employed (ongoing). Company-initiated (TERMINATED) and two-weeks
 * (QUIT_WITH_NOTICE) separations keep commissions flowing 30 days past the end
 * date; walking out (QUIT_NO_NOTICE) cuts them off ON the end date. A missing
 * separationType with an end date is treated as the generous 30-day case.
 */
export function commissionThroughDate(e: {
  endDate: Date | null;
  separationType: SeparationType | null;
}): Date | null {
  if (!e.endDate) return null; // still employed → commissions ongoing
  if (e.separationType === "QUIT_NO_NOTICE") return e.endDate;
  const d = new Date(e.endDate);
  d.setDate(d.getDate() + 30);
  return d;
}

/** Whether the employee still earns commissions as of `asOf` (default: today's arg). */
export function commissionsActiveOn(
  e: { endDate: Date | null; separationType: SeparationType | null },
  asOf: Date
): boolean {
  const through = commissionThroughDate(e);
  if (through === null) return true;
  return asOf.getTime() <= through.getTime();
}
