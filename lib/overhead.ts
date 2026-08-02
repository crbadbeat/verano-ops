// Pure landed-cost overhead math (no DB / server-only), so it's unit-testable
// and safe to import anywhere.

export const DEFAULT_OVERHEAD_BPS = 1180; // 11.80%

/** Basis points -> a percent string for display, e.g. 1180 -> "11.8". */
export function bpsToPercentString(bps: number): string {
  return (bps / 100).toLocaleString("en-US", { maximumFractionDigits: 2 });
}

/**
 * Add the landed-cost overhead to a base cost (cents), unless the warehouse is
 * exempt. `overheadBps` is basis points (1180 = +11.80%). Rounds to whole cents.
 */
export function burdenedCost(
  baseCents: number,
  overheadBps: number,
  exempt: boolean
): number {
  if (exempt || overheadBps <= 0) return baseCents;
  return Math.round((baseCents * (10000 + overheadBps)) / 10000);
}
