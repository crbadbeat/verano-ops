// Pure deposit-gate math (no DB / server-only), so it's unit-testable and safe to
// import anywhere. The gate decides whether a NetSuite-synced order has enough
// money down to be released to the scheduling team. Threshold and received amount
// are both in cents / basis points; % down is measured against the GRAND TOTAL
// (incl. tax + freight), per the product decision.

export const DEFAULT_MIN_DEPOSIT_BPS = 5000; // 50%

export interface DepositGate {
  /** True once the order has met the deposit threshold (or the gate doesn't apply). */
  met: boolean;
  /** True when we can't yet judge — deposits not synced, or no total to measure against. */
  unknown: boolean;
  /** Fraction paid, in basis points (received / total). Null when unknown. */
  pctBps: number | null;
  /** Cents that must be received to meet the threshold. Null when unknown. */
  requiredCents: number | null;
  /** Cents still needed to clear the gate (0 once met). Null when unknown. */
  shortfallCents: number | null;
}

/**
 * Evaluate the deposit gate for one order.
 *
 * `receivedCents` null → not yet synced ⇒ `unknown` (fail-OPEN: don't block on
 * data we don't have). `totalCents` null/≤0 → nothing to measure ⇒ `unknown`.
 * Otherwise the order is gated: met when received ≥ ceil(total × minBps / 10000).
 */
export function depositGate(
  receivedCents: number | null | undefined,
  totalCents: number | null | undefined,
  minDepositBps: number
): DepositGate {
  const unknownResult: DepositGate = {
    met: true, // fail-open: an un-judgeable order is never hard-blocked
    unknown: true,
    pctBps: null,
    requiredCents: null,
    shortfallCents: null,
  };

  if (receivedCents == null) return unknownResult;
  if (totalCents == null || totalCents <= 0) return unknownResult;

  const bps = Math.max(0, minDepositBps);
  const requiredCents = Math.ceil((totalCents * bps) / 10000);
  const received = Math.max(0, receivedCents);
  const pctBps = Math.round((received * 10000) / totalCents);
  const shortfallCents = Math.max(0, requiredCents - received);

  return {
    met: received >= requiredCents,
    unknown: false,
    pctBps,
    requiredCents,
    shortfallCents,
  };
}

/** Basis points -> a percent string for display, e.g. 5000 -> "50". */
export function depositPctString(bps: number): string {
  return (bps / 100).toLocaleString("en-US", { maximumFractionDigits: 2 });
}
