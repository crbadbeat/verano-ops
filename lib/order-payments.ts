// Payment arithmetic for an order. Pure — no DB — so the qualification rule that
// pays a rep an extra 1% is unit-tested rather than trusted.
//
// All money is Int cents, matching the rest of the schema.

export type PaymentMethodCode = "CHECK" | "WIRE_TRANSFER" | "CREDIT_CARD" | "GREENSKY";

export interface PaymentLike {
  method: PaymentMethodCode;
  amountCents: number;
}

/**
 * Methods that cost us nothing to accept. A card carries a processing fee and
 * GreenSky carries a financing fee; a cheque or a wire carries neither, which is
 * the whole reason the bonus exists.
 */
export const FEE_FREE_METHODS: PaymentMethodCode[] = ["CHECK", "WIRE_TRANSFER"];

/** How much may arrive by a fee-bearing method and still qualify: $1,000. */
export const PAID_IN_FULL_FEE_ALLOWANCE_CENTS = 100_000;

export const PAYMENT_METHOD_LABEL: Record<PaymentMethodCode, string> = {
  CHECK: "Check",
  WIRE_TRANSFER: "Wire transfer",
  CREDIT_CARD: "Credit card",
  GREENSKY: "GreenSky",
};

export interface PaymentTotals {
  paidCents: number;
  feeFreeCents: number;
  feeBearingCents: number;
  byMethod: Record<PaymentMethodCode, number>;
  /** total - paid; negative means overpaid. Null when the total is unknown. */
  outstandingCents: number | null;
}

export function paymentTotals(
  payments: PaymentLike[],
  totalCents: number | null | undefined
): PaymentTotals {
  const byMethod: Record<PaymentMethodCode, number> = {
    CHECK: 0,
    WIRE_TRANSFER: 0,
    CREDIT_CARD: 0,
    GREENSKY: 0,
  };
  let paidCents = 0;
  let feeFreeCents = 0;
  let feeBearingCents = 0;

  for (const p of payments) {
    byMethod[p.method] = (byMethod[p.method] ?? 0) + p.amountCents;
    paidCents += p.amountCents;
    if (FEE_FREE_METHODS.includes(p.method)) feeFreeCents += p.amountCents;
    else feeBearingCents += p.amountCents;
  }

  return {
    paidCents,
    feeFreeCents,
    feeBearingCents,
    byMethod,
    outstandingCents: totalCents == null ? null : totalCents - paidCents,
  };
}

/**
 * Whether an order LOOKS like it earns the rep the extra 1%: paid in full, with
 * no more than $1,000 of it on a card or GreenSky.
 *
 * This only decides whether to ASK. There are timing conditions the employee has
 * to verify that no data here can settle, so the flag is never set automatically
 * — see `app/orders/actions.ts`.
 */
export function qualifiesForPaidInFullBonus(
  payments: PaymentLike[],
  totalCents: number | null | undefined
): boolean {
  if (!totalCents || totalCents <= 0) return false;
  const totals = paymentTotals(payments, totalCents);
  if (totals.paidCents < totalCents) return false;
  return totals.feeBearingCents <= PAID_IN_FULL_FEE_ALLOWANCE_CENTS;
}

/** Normalise an address for comparison: case, spacing and punctuation only. */
function normalizeAddressPart(value: string | null | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/[.,#]/g, " ")
    .replace(/\s+/g, " ")
    .trim(); // last, so punctuation turned into space does not leave an edge
}

export interface AddressLike {
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
}

/**
 * True when the billing address differs from the delivery address, which is what
 * sends an order for a manual fraud check.
 *
 * An address we do not have is NOT a mismatch — a half-filled agreement should
 * not manufacture a fraud flag.
 */
export function billingDiffersFromDelivery(
  billing: AddressLike,
  delivery: AddressLike
): boolean {
  const fields: (keyof AddressLike)[] = ["address", "city", "state", "zip"];
  const known = fields.filter(
    (f) => normalizeAddressPart(billing[f]) !== "" && normalizeAddressPart(delivery[f]) !== ""
  );
  if (known.length === 0) return false;
  return known.some((f) => normalizeAddressPart(billing[f]) !== normalizeAddressPart(delivery[f]));
}
