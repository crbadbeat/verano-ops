import { describe, it, expect } from "vitest";
import { aggregateCounts, variance, type CountObservation } from "./count";

/** Most observations are ordinary new stock; spell out only what matters. */
function obs(o: Partial<CountObservation> & { qty: number }): CountObservation {
  return {
    productId: o.productId ?? "p1",
    locationId: o.locationId ?? null,
    condition: o.condition ?? "NEW",
    qty: o.qty,
  };
}

describe("aggregateCounts", () => {
  it("sums qty per (product, location) and counts entries", () => {
    const agg = aggregateCounts([
      obs({ productId: "p1", locationId: "b1", qty: 3 }),
      obs({ productId: "p1", locationId: "b1", qty: 2 }),
      obs({ productId: "p1", locationId: "b2", qty: 5 }),
      obs({ productId: "p2", locationId: null, qty: 4 }),
    ]);

    const p1b1 = agg.find((a) => a.productId === "p1" && a.locationId === "b1");
    expect(p1b1?.counted).toBe(5);
    expect(p1b1?.entryCount).toBe(2);

    const p2wh = agg.find((a) => a.productId === "p2" && a.locationId === null);
    expect(p2wh?.counted).toBe(4);

    expect(agg.length).toBe(3);
  });

  it("keeps warehouse-level (null location) separate from bins", () => {
    const agg = aggregateCounts([
      obs({ locationId: null, qty: 10 }),
      obs({ locationId: "b1", qty: 1 }),
    ]);
    expect(agg.length).toBe(2);
  });
});

describe("aggregateCounts — stock condition", () => {
  it("keeps show goods separate from new stock in the SAME bin", () => {
    // The case that matters: both conditions live in one bin, and merging them
    // would post a single combined number and wipe the other one out.
    const agg = aggregateCounts([
      obs({ locationId: "b1", condition: "NEW", qty: 6 }),
      obs({ locationId: "b1", condition: "SHOW_GOOD", qty: 2 }),
    ]);
    expect(agg.length).toBe(2);
    expect(agg.find((a) => a.condition === "NEW")?.counted).toBe(6);
    expect(agg.find((a) => a.condition === "SHOW_GOOD")?.counted).toBe(2);
  });

  it("still sums repeat observations within one condition", () => {
    const agg = aggregateCounts([
      obs({ locationId: "b1", condition: "SHOW_GOOD", qty: 1 }),
      obs({ locationId: "b1", condition: "SHOW_GOOD", qty: 1 }),
      obs({ locationId: "b1", condition: "SHOW_GOOD", qty: 3 }),
    ]);
    expect(agg).toHaveLength(1);
    expect(agg[0].counted).toBe(5);
    expect(agg[0].entryCount).toBe(3);
  });

  it("separates the same product and condition across different bins", () => {
    const agg = aggregateCounts([
      obs({ locationId: "b1", condition: "SHOW_GOOD", qty: 2 }),
      obs({ locationId: "b2", condition: "SHOW_GOOD", qty: 3 }),
    ]);
    expect(agg).toHaveLength(2);
  });

  it("carries the condition through to the aggregate", () => {
    const agg = aggregateCounts([obs({ condition: "SHOW_GOOD", qty: 4 })]);
    expect(agg[0].condition).toBe("SHOW_GOOD");
  });
});

describe("variance", () => {
  it("is counted minus system-derived on-hand", () => {
    expect(variance(10, 7)).toBe(3);
    expect(variance(5, 8)).toBe(-3);
    expect(variance(4, 4)).toBe(0);
  });
});
