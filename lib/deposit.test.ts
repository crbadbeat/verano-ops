import { describe, it, expect } from "vitest";
import { depositGate, depositPctString, DEFAULT_MIN_DEPOSIT_BPS } from "./deposit";

describe("depositGate", () => {
  it("meets the gate when received >= required (50% of total)", () => {
    const g = depositGate(50000, 100000, 5000); // $500 of $1000, 50% required
    expect(g).toMatchObject({ met: true, unknown: false, pctBps: 5000, requiredCents: 50000, shortfallCents: 0 });
  });

  it("fails the gate and reports the shortfall when under-deposited", () => {
    const g = depositGate(30000, 100000, 5000); // $300 of $1000
    expect(g.met).toBe(false);
    expect(g.pctBps).toBe(3000); // 30%
    expect(g.requiredCents).toBe(50000);
    expect(g.shortfallCents).toBe(20000); // needs $200 more
  });

  it("rounds the required amount up so a penny short does not pass", () => {
    // 50% of 101 cents = 50.5 -> required 51; 50 received is short by 1.
    const g = depositGate(50, 101, 5000);
    expect(g.requiredCents).toBe(51);
    expect(g.met).toBe(false);
    expect(g.shortfallCents).toBe(1);
  });

  it("is UNKNOWN (fail-open, not blocked) when deposits are not yet synced", () => {
    const g = depositGate(null, 100000, 5000);
    expect(g).toMatchObject({ met: true, unknown: true, pctBps: null, requiredCents: null, shortfallCents: null });
  });

  it("is UNKNOWN when there is no total to measure against", () => {
    expect(depositGate(0, null, 5000).unknown).toBe(true);
    expect(depositGate(0, 0, 5000).unknown).toBe(true);
  });

  it("a 0% threshold is always met once synced", () => {
    expect(depositGate(0, 100000, 0)).toMatchObject({ met: true, unknown: false, requiredCents: 0 });
  });

  it("caps the percentage inputs sanely (negative received treated as 0)", () => {
    const g = depositGate(-100, 100000, 5000);
    expect(g.pctBps).toBe(0);
    expect(g.met).toBe(false);
  });
});

describe("depositPctString / default", () => {
  it("formats basis points as a percent", () => {
    expect(depositPctString(5000)).toBe("50");
    expect(depositPctString(2550)).toBe("25.5");
  });
  it("defaults to 50%", () => {
    expect(DEFAULT_MIN_DEPOSIT_BPS).toBe(5000);
  });
});
