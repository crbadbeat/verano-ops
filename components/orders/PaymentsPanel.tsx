import {
  PAID_IN_FULL_FEE_ALLOWANCE_CENTS,
  PAYMENT_METHOD_LABEL,
  paymentTotals,
  qualifiesForPaidInFullBonus,
  type PaymentMethodCode,
} from "@/lib/order-payments";
import {
  addOrderPayment,
  removeOrderPayment,
  setPaidInFullOnePercent,
} from "@/app/orders/actions";

function money(cents: number | null | undefined): string {
  if (cents == null) return "—";
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export interface PaymentRow {
  id: string;
  method: PaymentMethodCode;
  amountCents: number;
  reference: string | null;
  receivedAt: Date | null;
  createdAt: Date;
  createdBy: { email: string } | null;
}

const METHODS: PaymentMethodCode[] = [
  "CHECK",
  "WIRE_TRANSFER",
  "CREDIT_CARD",
  "GREENSKY",
];

export default function PaymentsPanel({
  orderId,
  payments,
  totalCents,
  printedDownPaymentCents,
  paidInFullOnePercent,
  paidInFullConfirmedAt,
  canEdit,
}: {
  orderId: string;
  payments: PaymentRow[];
  totalCents: number | null;
  printedDownPaymentCents: number | null;
  paidInFullOnePercent: boolean;
  paidInFullConfirmedAt: Date | null;
  canEdit: boolean;
}) {
  const totals = paymentTotals(payments, totalCents);
  const looksEligible = qualifiesForPaidInFullBonus(payments, totalCents);
  // Only ask once — a confirmed decision either way stops the prompt.
  const askAboutBonus = looksEligible && paidInFullConfirmedAt == null;

  const printedMismatch =
    printedDownPaymentCents != null &&
    payments.length > 0 &&
    totals.paidCents !== printedDownPaymentCents;

  return (
    <div className="card overflow-hidden">
      <div className="p-4 border-b border-border flex items-center gap-3 flex-wrap">
        <h2 className="font-semibold">Payments</h2>
        <span className="badge text-muted">{payments.length}</span>
        {paidInFullOnePercent && (
          <span className="badge text-success" title="Rep earns an extra 1%">
            Paid In Full 1%
          </span>
        )}
        <span className="ml-auto text-sm tabular-nums">
          {money(totals.paidCents)} of {money(totalCents)}
        </span>
      </div>

      <div className="px-4 py-3 grid grid-cols-2 gap-3 text-sm border-b border-border/60">
        <Figure label="Paid" value={money(totals.paidCents)} />
        <Figure
          label="Outstanding"
          value={money(totals.outstandingCents)}
          tone={
            totals.outstandingCents == null
              ? undefined
              : totals.outstandingCents > 0
                ? "text-ember"
                : "text-success"
          }
        />
      </div>

      {/* Each instrument on its own. They are not interchangeable: a cheque and
          a wire cost us nothing, a card and GreenSky each carry their own fee. */}
      <div className="px-4 py-3 grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm border-b border-border/60">
        {METHODS.map((m) => (
          <Figure
            key={m}
            label={PAYMENT_METHOD_LABEL[m]}
            value={money(totals.byMethod[m])}
            tone={totals.byMethod[m] > 0 ? undefined : "text-muted"}
          />
        ))}
      </div>

      {printedMismatch && (
        <p className="px-4 pt-3 text-xs text-muted">
          The agreement prints a down payment of {money(printedDownPaymentCents)} —
          recorded payments come to {money(totals.paidCents)}.
        </p>
      )}

      {askAboutBonus && canEdit && (
        <div className="mx-4 my-3 rounded-lg border border-ember/50 bg-surface-2 p-4">
          <h3 className="font-semibold text-sm">Does this qualify for Paid In Full 1%?</h3>
          <p className="text-sm text-muted mt-1">
            It is paid in full and only {money(totals.feeBearingCents)} came in on a
            card or GreenSky — within the {money(PAID_IN_FULL_FEE_ALLOWANCE_CENTS)}{" "}
            allowance. Check the timing conditions before answering; the rep earns
            an extra 1% on a Yes.
          </p>
          <div className="flex gap-2 mt-3">
            <form action={setPaidInFullOnePercent}>
              <input type="hidden" name="orderId" value={orderId} />
              <input type="hidden" name="qualifies" value="1" />
              <button className="btn btn-primary py-1 px-4 text-sm" type="submit">
                Yes
              </button>
            </form>
            <form action={setPaidInFullOnePercent}>
              <input type="hidden" name="orderId" value={orderId} />
              <input type="hidden" name="qualifies" value="0" />
              <button className="btn btn-ghost py-1 px-4 text-sm" type="submit">
                No
              </button>
            </form>
          </div>
        </div>
      )}

      {!askAboutBonus && paidInFullConfirmedAt != null && canEdit && (
        <div className="px-4 py-2 border-b border-border/60 flex items-center gap-2 text-sm flex-wrap">
          <span className="text-muted">
            Paid In Full 1%: <strong>{paidInFullOnePercent ? "Yes" : "No"}</strong>
          </span>
          <form action={setPaidInFullOnePercent} className="ml-auto">
            <input type="hidden" name="orderId" value={orderId} />
            <input type="hidden" name="qualifies" value={paidInFullOnePercent ? "0" : "1"} />
            <button className="btn btn-ghost py-0.5 px-2 text-xs" type="submit">
              Change to {paidInFullOnePercent ? "No" : "Yes"}
            </button>
          </form>
        </div>
      )}

      {payments.length > 0 && (
        <ul className="divide-y divide-border/60">
          {payments.map((p) => (
            <li key={p.id} className="px-4 py-2.5 flex items-center gap-3 text-sm flex-wrap">
              <span className="badge text-muted text-xs">
                {PAYMENT_METHOD_LABEL[p.method]}
              </span>
              <span className="tabular-nums">{money(p.amountCents)}</span>
              {p.reference && <span className="text-xs text-muted">{p.reference}</span>}
              <span className="ml-auto text-xs text-muted">
                {(p.receivedAt ?? p.createdAt).toLocaleDateString("en-US", {
                  dateStyle: "medium",
                })}
                {p.createdBy ? ` · ${p.createdBy.email}` : ""}
              </span>
              {canEdit && (
                <form action={removeOrderPayment}>
                  <input type="hidden" name="paymentId" value={p.id} />
                  <button className="btn btn-ghost py-0.5 px-2 text-xs text-danger" type="submit">
                    Remove
                  </button>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}

      {canEdit && (
        <form
          action={addOrderPayment}
          className="p-4 border-t border-border grid grid-cols-2 sm:grid-cols-5 gap-2"
        >
          <input type="hidden" name="orderId" value={orderId} />
          <select name="method" required className="input text-sm" aria-label="Method">
            <option value="">How paid…</option>
            {METHODS.map((m) => (
              <option key={m} value={m}>
                {PAYMENT_METHOD_LABEL[m]}
              </option>
            ))}
          </select>
          <input
            name="amount"
            required
            inputMode="decimal"
            placeholder="Amount"
            className="input text-sm"
            aria-label="Amount"
          />
          <input
            name="reference"
            placeholder="Check # / ref"
            className="input text-sm"
            aria-label="Reference"
          />
          <input name="receivedAt" type="date" className="input text-sm" aria-label="Received" />
          <button className="btn btn-primary text-sm" type="submit">
            Record payment
          </button>
        </form>
      )}
    </div>
  );
}

function Figure({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <div>
      <div className="text-xs text-muted">{label}</div>
      <div className={`tabular-nums ${tone ?? ""}`}>{value}</div>
    </div>
  );
}
