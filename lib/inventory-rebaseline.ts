// Pure re-baseline math (no DB) — unit-tested in lib/inventory-rebaseline.test.ts.
//
// A full-replace "inventory by location" upload: on-hand is set to exactly the
// uploaded slots, and every current slot NOT in the upload is zeroed. Both are
// expressed as ledger DELTAS so history is kept — nothing is deleted. A slot is
// (product, location, condition); location null = warehouse level.

export type Condition = "NEW" | "SHOW_GOOD";

export interface Slot {
  productId: string;
  locationId: string | null;
  condition: Condition;
}
export interface SlotQty extends Slot {
  qty: number;
}
export interface SlotDelta extends Slot {
  delta: number;
  targetQty: number | null; // the uploaded target, or null when the slot is being cleared
}

function slotKey(s: Slot): string {
  return `${s.productId}|${s.locationId ?? "~wh"}|${s.condition}`;
}

/**
 * Deltas that make on-hand exactly match `target`, zeroing any `current` slot the
 * upload didn't mention. `target` rows are summed per slot first. Only nonzero
 * deltas are returned.
 */
export function computeRebaseline(target: SlotQty[], current: SlotQty[]): SlotDelta[] {
  const targetBySlot = new Map<string, SlotQty>();
  for (const t of target) {
    const k = slotKey(t);
    const e = targetBySlot.get(k);
    if (e) e.qty += t.qty;
    else targetBySlot.set(k, { ...t });
  }
  const currentBySlot = new Map(current.map((c) => [slotKey(c), c.qty] as const));

  const out: SlotDelta[] = [];

  // Set every uploaded slot to its target.
  for (const t of targetBySlot.values()) {
    const cur = currentBySlot.get(slotKey(t)) ?? 0;
    const delta = t.qty - cur;
    if (delta !== 0) {
      out.push({
        productId: t.productId,
        locationId: t.locationId,
        condition: t.condition,
        delta,
        targetQty: t.qty,
      });
    }
  }

  // Clear every current slot the upload didn't list.
  for (const c of current) {
    if (targetBySlot.has(slotKey(c))) continue;
    if (c.qty === 0) continue;
    out.push({
      productId: c.productId,
      locationId: c.locationId,
      condition: c.condition,
      delta: -c.qty,
      targetQty: null,
    });
  }

  return out;
}
