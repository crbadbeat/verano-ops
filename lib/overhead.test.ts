import { describe, it, expect } from "vitest";
import { burdenedCost, bpsToPercentString, DEFAULT_OVERHEAD_BPS } from "./overhead";

describe("burdenedCost", () => {
  it("adds the overhead to a base cost, rounded to cents", () => {
    // $100.00 + 11.8% = $111.80
    expect(burdenedCost(10000, 1180, false)).toBe(11180);
    // rounds: 5023 * 1.118 = 5615.714 -> 5616
    expect(burdenedCost(5023, 1180, false)).toBe(5616);
  });

  it("leaves exempt warehouses at the base cost", () => {
    expect(burdenedCost(10000, 1180, true)).toBe(10000);
  });

  it("is a no-op at zero (or negative) overhead", () => {
    expect(burdenedCost(10000, 0, false)).toBe(10000);
    expect(burdenedCost(10000, -50, false)).toBe(10000);
  });

  it("the default is 11.8%", () => {
    expect(DEFAULT_OVERHEAD_BPS).toBe(1180);
    expect(bpsToPercentString(DEFAULT_OVERHEAD_BPS)).toBe("11.8");
  });
});
