import { describe, it, expect } from "vitest";
import {
  billingDiffersFromDelivery,
  paymentTotals,
  qualifiesForPaidInFullBonus,
  type PaymentLike,
} from "./order-payments";

const check = (cents: number): PaymentLike => ({ method: "CHECK", amountCents: cents });
const wire = (cents: number): PaymentLike => ({ method: "WIRE_TRANSFER", amountCents: cents });
const card = (cents: number): PaymentLike => ({ method: "CREDIT_CARD", amountCents: cents });
const greensky = (cents: number): PaymentLike => ({ method: "GREENSKY", amountCents: cents });

const TOTAL = 4_086_534; // $40,865.34 — the reference agreement

describe("paymentTotals", () => {
  it("splits fee-free from fee-bearing money", () => {
    const t = paymentTotals([check(1_000_00), card(250_00), wire(500_00)], TOTAL);
    expect(t.paidCents).toBe(1_750_00);
    expect(t.feeFreeCents).toBe(1_500_00);
    expect(t.feeBearingCents).toBe(250_00);
  });

  it("totals each method separately", () => {
    const t = paymentTotals([check(100), check(200), greensky(50)], null);
    expect(t.byMethod.CHECK).toBe(300);
    expect(t.byMethod.GREENSKY).toBe(50);
    expect(t.byMethod.WIRE_TRANSFER).toBe(0);
  });

  it("reports what is still outstanding, and knows when it cannot", () => {
    expect(paymentTotals([check(1_000_00)], TOTAL).outstandingCents).toBe(TOTAL - 1_000_00);
    expect(paymentTotals([check(TOTAL + 500)], TOTAL).outstandingCents).toBe(-500);
    expect(paymentTotals([check(100)], null).outstandingCents).toBeNull();
  });
});

describe("qualifiesForPaidInFullBonus", () => {
  it("qualifies when the whole amount came by check", () => {
    expect(qualifiesForPaidInFullBonus([check(TOTAL)], TOTAL)).toBe(true);
  });

  it("qualifies when all but $1,000 came by check or wire", () => {
    expect(
      qualifiesForPaidInFullBonus([check(TOTAL - 1_000_00), card(1_000_00)], TOTAL)
    ).toBe(true);
    expect(
      qualifiesForPaidInFullBonus(
        [wire(TOTAL - 999_00), greensky(999_00)],
        TOTAL
      )
    ).toBe(true);
  });

  it("does not qualify when more than $1,000 carried a fee", () => {
    expect(
      qualifiesForPaidInFullBonus([check(TOTAL - 1_000_01), card(1_000_01)], TOTAL)
    ).toBe(false);
  });

  it("does not qualify until the order is paid in full", () => {
    expect(qualifiesForPaidInFullBonus([check(TOTAL - 1)], TOTAL)).toBe(false);
  });

  it("still qualifies when the customer overpaid", () => {
    expect(qualifiesForPaidInFullBonus([check(TOTAL + 5_000)], TOTAL)).toBe(true);
  });

  it("never qualifies without a total to measure against", () => {
    expect(qualifiesForPaidInFullBonus([check(500_00)], null)).toBe(false);
    expect(qualifiesForPaidInFullBonus([check(500_00)], 0)).toBe(false);
  });

  it("never qualifies with no payments recorded", () => {
    expect(qualifiesForPaidInFullBonus([], TOTAL)).toBe(false);
  });
});

describe("billingDiffersFromDelivery", () => {
  const home = { address: "1206 SW Live Oak Cove", city: "Port St Lucie", state: "FL", zip: "34986" };

  it("is quiet when the two addresses match", () => {
    expect(billingDiffersFromDelivery(home, { ...home })).toBe(false);
  });

  it("ignores case, spacing and punctuation", () => {
    expect(
      billingDiffersFromDelivery(home, {
        address: "1206 sw live  oak cove.",
        city: "PORT ST LUCIE",
        state: "fl",
        zip: "34986",
      })
    ).toBe(false);
  });

  it("flags a different street, city or zip", () => {
    expect(billingDiffersFromDelivery(home, { ...home, address: "10511 SW Village" })).toBe(true);
    expect(billingDiffersFromDelivery(home, { ...home, city: "Margate" })).toBe(true);
    expect(billingDiffersFromDelivery(home, { ...home, zip: "34987" })).toBe(true);
  });

  it("does not invent a mismatch out of missing data", () => {
    // A half-filled agreement must not manufacture a fraud flag.
    expect(billingDiffersFromDelivery({}, home)).toBe(false);
    expect(billingDiffersFromDelivery(home, {})).toBe(false);
    expect(billingDiffersFromDelivery({ zip: "34986" }, { zip: "34986", city: "Margate" })).toBe(
      false
    );
  });
});
