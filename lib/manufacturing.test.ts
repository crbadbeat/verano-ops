import { describe, it, expect } from "vitest";
import { bonusShares, usdToCents, centsToUsd, explodeBom } from "./manufacturing";

describe("bonusShares", () => {
  it("gives one worker the full bonus", () => {
    expect(bonusShares(2500, 1)).toEqual([2500]);
  });

  it("splits evenly across two workers", () => {
    expect(bonusShares(2500, 2)).toEqual([1250, 1250]);
  });

  it("gives the odd cent to the first worker and still sums to the total", () => {
    const shares = bonusShares(2501, 2);
    expect(shares).toEqual([1251, 1250]);
    expect(shares.reduce((a, b) => a + b, 0)).toBe(2501);
  });

  it("handles an N-way split with the remainder up front", () => {
    const shares = bonusShares(1000, 3);
    expect(shares).toEqual([334, 333, 333]);
    expect(shares.reduce((a, b) => a + b, 0)).toBe(1000);
  });

  it("never returns negative shares", () => {
    expect(bonusShares(0, 2)).toEqual([0, 0]);
  });
});

describe("usd <-> cents", () => {
  it("parses dollars to cents", () => {
    expect(usdToCents("25.05")).toBe(2505);
    expect(usdToCents(10)).toBe(1000);
    expect(usdToCents("")).toBe(0);
  });

  it("formats cents to dollars", () => {
    expect(centsToUsd(2505)).toBe("25.05");
    expect(centsToUsd(1000)).toBe("10.00");
  });
});

describe("explodeBom", () => {
  it("multiplies each component by the number of finished units", () => {
    const lines = [
      { componentId: "a", qty: 2 },
      { componentId: "b", qty: 5 },
    ];
    expect(explodeBom(lines, 3)).toEqual([
      { componentId: "a", qty: 6 },
      { componentId: "b", qty: 15 },
    ]);
  });

  it("returns zero quantities for zero units", () => {
    expect(explodeBom([{ componentId: "a", qty: 2 }], 0)).toEqual([
      { componentId: "a", qty: 0 },
    ]);
  });
});
