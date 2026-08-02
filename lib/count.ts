// Pure count-reconciliation helpers (no DB) — unit-tested in lib/count.test.ts.
// The DB-touching post/review logic lives in app/count/actions.ts and imports
// these so the arithmetic stays testable in isolation.

/** Mirrors the StockCondition enum without importing the generated client. */
export type CountCondition = "NEW" | "SHOW_GOOD";

export interface CountObservation {
  productId: string | null;
  locationId: string | null;
  condition: CountCondition;
  qty: number;
}

export interface AggregatedCount {
  productId: string | null;
  locationId: string | null;
  condition: CountCondition;
  counted: number;
  entryCount: number;
}

/**
 * Sum blind-count observations into one counted total per
 * (product, location, condition). Many entries for the same slot (e.g. tops
 * scanned one by one) collapse into a single counted number — the hub compiles
 * locations from the scans themselves.
 *
 * Condition is part of the key: show goods sit in the same bins as new stock, so
 * merging them would post one combined number and wipe out the other condition.
 */
export function aggregateCounts(obs: CountObservation[]): AggregatedCount[] {
  const map = new Map<string, AggregatedCount>();
  for (const o of obs) {
    const key = `${o.productId ?? "_"}::${o.locationId ?? "_"}::${o.condition}`;
    const cur = map.get(key);
    if (cur) {
      cur.counted += o.qty;
      cur.entryCount += 1;
    } else {
      map.set(key, {
        productId: o.productId,
        locationId: o.locationId,
        condition: o.condition,
        counted: o.qty,
        entryCount: 1,
      });
    }
  }
  return [...map.values()];
}

/** Variance = counted − system-derived on-hand. Positive => count is higher. */
export function variance(counted: number, derived: number): number {
  return counted - derived;
}
