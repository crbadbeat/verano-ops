// Pure picking helpers (no DB) — unit-tested in lib/picking.test.ts.
// Pickers work one category at a time and walk the warehouse row → bin; needed
// vs staged is derived, never stored.

import { compareAisles, compareBins } from "./location-code";
import { remainingToCheckIn } from "./transfers";

export type PickBucket = "BASE" | "GLASS" | "APPLIANCE" | "OTHER";

/**
 * Which pick tab a product belongs to. Matches the count flow's category
 * matching (base / glass / appliance+raw+extra); anything else is OTHER so it is
 * still pickable, just not one of the three named types.
 */
export function pickCategory(category: string | null): PickBucket {
  const c = (category ?? "").toLowerCase();
  if (c.includes("base")) return "BASE";
  if (c.includes("glass")) return "GLASS";
  if (c.includes("appl") || c.includes("raw") || c.includes("extra")) return "APPLIANCE";
  return "OTHER";
}

export interface LocationSource {
  aisle: string | null;
  bay: string | null;
  level: number | null;
}

/**
 * Order source bins into a walking path: by aisle (natural order, not string
 * order), then bay then level. Unstructured / warehouse-level (null aisle) sorts
 * last. A real floor-layout directed path is a later enhancement.
 */
export function sortSourcesByLocation<T extends LocationSource>(sources: T[]): T[] {
  return [...sources].sort((a, b) => {
    if (!a.aisle && !b.aisle) return 0;
    if (!a.aisle) return 1;
    if (!b.aisle) return -1;
    const byAisle = compareAisles(a.aisle, b.aisle);
    if (byAisle !== 0) return byAisle;
    return compareBins(a, b);
  });
}

export interface PickNeed {
  productId: string;
  needed: number;
}

export interface PickLineProgress {
  productId: string;
  needed: number;
  staged: number;
  remaining: number;
  done: boolean;
}

/**
 * Per-product pick progress: needed (from the trip's order lines) vs staged (net
 * ledger qty in the trip's lane). `remaining` clamps at 0 so an over-stage never
 * reads negative. `allDone` requires at least one line.
 */
export function summarizePick(
  needed: PickNeed[],
  staged: Map<string, number>
): { lines: PickLineProgress[]; allDone: boolean; shortCount: number } {
  const lines: PickLineProgress[] = needed.map((n) => {
    const s = staged.get(n.productId) ?? 0;
    const remaining = remainingToCheckIn(n.needed, s);
    return { productId: n.productId, needed: n.needed, staged: s, remaining, done: remaining === 0 };
  });
  const allDone = lines.length > 0 && lines.every((l) => l.done);
  const shortCount = lines.filter((l) => l.remaining > 0).length;
  return { lines, allDone, shortCount };
}
