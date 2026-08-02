// Pure manufacturing helpers (no DB) — unit-tested in lib/manufacturing.test.ts.
// Money is handled in integer cents everywhere to avoid float rounding drift.

// The build stages, in order. Matches the Prisma `JobStage` enum.
export const JOB_STAGES = [
  "WELDING",
  "BOARDING",
  "STUCCO",
  "ELECTRICAL",
  "WRAPPING",
] as const;
export type Stage = (typeof JOB_STAGES)[number];
export const STAGE_LABEL: Record<Stage, string> = {
  WELDING: "Welding",
  BOARDING: "Boarding",
  STUCCO: "Stucco",
  ELECTRICAL: "Electrical",
  WRAPPING: "Wrapping",
};

/**
 * Split a bonus (in cents) across N workers. Even split; any leftover cent(s)
 * go to the first worker(s), so the shares always sum back to `rateCents`.
 */
export function bonusShares(rateCents: number, workerCount: number): number[] {
  const r = Math.max(0, Math.round(rateCents));
  if (workerCount <= 1) return [r];
  const base = Math.floor(r / workerCount);
  const remainder = r - base * workerCount;
  return Array.from({ length: workerCount }, (_, i) => base + (i < remainder ? 1 : 0));
}

/** Parse a dollar string/number into integer cents. */
export function usdToCents(usd: string | number): number {
  const n = typeof usd === "string" ? parseFloat(usd) : usd;
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

/** Format integer cents as a dollar string (no symbol), e.g. 2505 -> "25.05". */
export function centsToUsd(cents: number): string {
  return (Math.round(cents) / 100).toFixed(2);
}

export interface BomLine {
  componentId: string;
  qty: number;
}

/** Explode a BOM for `units` finished goods into component quantities to consume. */
export function explodeBom(lines: BomLine[], units: number): BomLine[] {
  const u = Math.max(0, Math.round(units));
  return lines.map((l) => ({ componentId: l.componentId, qty: l.qty * u }));
}
