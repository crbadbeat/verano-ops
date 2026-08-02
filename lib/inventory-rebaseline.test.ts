import { describe, it, expect } from "vitest";
import { computeRebaseline, type SlotQty, type SlotDelta } from "./inventory-rebaseline";

const s = (
  productId: string,
  locationId: string | null,
  qty: number,
  condition: "NEW" | "SHOW_GOOD" = "NEW"
): SlotQty => ({ productId, locationId, condition, qty });

// Order-independent comparison.
const norm = (rows: SlotDelta[]) =>
  [...rows].sort((a, b) =>
    `${a.productId}${a.locationId}${a.condition}`.localeCompare(`${b.productId}${b.locationId}${b.condition}`)
  );

describe("computeRebaseline", () => {
  it("sets a brand-new slot to its uploaded quantity", () => {
    expect(computeRebaseline([s("a", "bin1", 5)], [])).toEqual([
      { productId: "a", locationId: "bin1", condition: "NEW", delta: 5, targetQty: 5 },
    ]);
  });

  it("adjusts an existing slot up or down", () => {
    expect(computeRebaseline([s("a", null, 3)], [s("a", null, 10)])).toEqual([
      { productId: "a", locationId: null, condition: "NEW", delta: -7, targetQty: 3 },
    ]);
  });

  it("zeroes a current slot the upload didn't mention", () => {
    expect(computeRebaseline([], [s("a", null, 10)])).toEqual([
      { productId: "a", locationId: null, condition: "NEW", delta: -10, targetQty: null },
    ]);
  });

  it("is a no-op when the upload matches current on-hand exactly", () => {
    expect(computeRebaseline([s("a", null, 5), s("b", "bin1", 2)], [s("a", null, 5), s("b", "bin1", 2)])).toEqual([]);
  });

  it("moves stock from warehouse level into a bin (set + clear)", () => {
    const out = norm(computeRebaseline([s("a", "bin1", 5)], [s("a", null, 5)]));
    expect(out).toEqual([
      { productId: "a", locationId: "bin1", condition: "NEW", delta: 5, targetQty: 5 },
      { productId: "a", locationId: null, condition: "NEW", delta: -5, targetQty: null },
    ]);
  });

  it("sums duplicate upload rows for the same slot", () => {
    expect(computeRebaseline([s("a", "bin1", 2), s("a", "bin1", 3)], [])).toEqual([
      { productId: "a", locationId: "bin1", condition: "NEW", delta: 5, targetQty: 5 },
    ]);
  });

  it("keeps NEW and SHOW_GOOD in one bin as separate slots", () => {
    const out = norm(
      computeRebaseline([s("a", "bin1", 1, "NEW")], [s("a", "bin1", 4, "SHOW_GOOD")])
    );
    expect(out).toEqual([
      { productId: "a", locationId: "bin1", condition: "NEW", delta: 1, targetQty: 1 },
      { productId: "a", locationId: "bin1", condition: "SHOW_GOOD", delta: -4, targetQty: null },
    ]);
  });

  it("ignores current slots that are already zero", () => {
    expect(computeRebaseline([], [s("a", null, 0)])).toEqual([]);
  });
});
