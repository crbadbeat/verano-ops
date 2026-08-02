import { describe, it, expect } from "vitest";
import { aggregateLines, remainingToCheckIn, clampCheckIn } from "./transfers";

describe("aggregateLines", () => {
  it("sums quantities per product", () => {
    const out = aggregateLines([
      { productId: "p1", qty: 2 },
      { productId: "p1", qty: 3 },
      { productId: "p2", qty: 1 },
    ]);
    expect(out).toEqual([
      { productId: "p1", qty: 5 },
      { productId: "p2", qty: 1 },
    ]);
  });

  it("keeps unmatched lines separate instead of merging them", () => {
    const out = aggregateLines([
      { productId: null, qty: 1 },
      { productId: null, qty: 2 },
      { productId: "p1", qty: 4 },
    ]);
    expect(out.filter((l) => l.productId === null)).toHaveLength(2);
    expect(out.find((l) => l.productId === "p1")?.qty).toBe(4);
  });
});

describe("remainingToCheckIn", () => {
  it("is expected minus already checked in, never negative", () => {
    expect(remainingToCheckIn(5, 2)).toBe(3);
    expect(remainingToCheckIn(5, 5)).toBe(0);
    expect(remainingToCheckIn(5, 9)).toBe(0);
  });
});

describe("clampCheckIn", () => {
  it("caps a check-in at what is still outstanding", () => {
    expect(clampCheckIn(10, 5, 0)).toBe(5);
    expect(clampCheckIn(2, 5, 1)).toBe(2);
    expect(clampCheckIn(99, 5, 5)).toBe(0);
  });

  it("rejects zero/negative/non-finite requests", () => {
    expect(clampCheckIn(0, 5, 0)).toBe(0);
    expect(clampCheckIn(-3, 5, 0)).toBe(0);
    expect(clampCheckIn(Number.NaN, 5, 0)).toBe(0);
  });
});
