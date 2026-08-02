import { describe, it, expect } from "vitest";
import { money, moneyFloor, pctFloor } from "./format";

describe("moneyFloor", () => {
  it("rounds whole-dollar amounts DOWN, never up", () => {
    expect(moneyFloor(99_995)).toBe("$999"); // $999.95 -> $999, not $1,000
    expect(moneyFloor(123_499)).toBe("$1,234");
    expect(moneyFloor(100_000)).toBe("$1,000");
    expect(moneyFloor(0)).toBe("$0");
  });

  it("differs from money() when money() would round up", () => {
    // money() rounds to nearest; moneyFloor() always truncates toward zero.
    expect(money(99_995)).toBe("$1,000");
    expect(moneyFloor(99_995)).toBe("$999");
  });
});

describe("pctFloor", () => {
  it("floors the percentage so 99.95% never reads as 100%", () => {
    expect(pctFloor(9995 / 10000)).toBe("99%");
    expect(pctFloor(0.4249)).toBe("42%");
    expect(pctFloor(1)).toBe("100%");
    expect(pctFloor(1.5)).toBe("150%");
  });

  it("renders an em dash for a null (no-goal) percentage", () => {
    expect(pctFloor(null)).toBe("—");
  });
});
