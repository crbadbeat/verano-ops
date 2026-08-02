// Pure transfer/return helpers (no DB) — unit-tested in lib/transfers.test.ts.

export interface LineQty {
  productId: string | null;
  qty: number;
}

/**
 * Collapse many lines into one qty per product (unmatched lines,
 * productId === null, are kept separate and never merged together).
 */
export function aggregateLines(lines: LineQty[]): LineQty[] {
  const byProduct = new Map<string, number>();
  const unmatched: LineQty[] = [];
  for (const l of lines) {
    if (l.productId == null) {
      unmatched.push({ productId: null, qty: l.qty });
      continue;
    }
    byProduct.set(l.productId, (byProduct.get(l.productId) ?? 0) + l.qty);
  }
  return [
    ...[...byProduct.entries()].map(([productId, qty]) => ({ productId, qty })),
    ...unmatched,
  ];
}

/** How many units of a flagged return line are still outstanding. */
export function remainingToCheckIn(expected: number, checkedIn: number): number {
  return Math.max(0, expected - checkedIn);
}

/** Clamp a check-in quantity so it can never exceed what's still outstanding. */
export function clampCheckIn(
  requested: number,
  expected: number,
  alreadyCheckedIn: number
): number {
  const remaining = remainingToCheckIn(expected, alreadyCheckedIn);
  if (!Number.isFinite(requested) || requested <= 0) return 0;
  return Math.min(Math.round(requested), remaining);
}
