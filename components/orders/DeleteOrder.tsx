"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";

function ConfirmButton() {
  const { pending } = useFormStatus();
  return (
    <button className="btn btn-primary py-1 px-4 text-sm" type="submit" disabled={pending}>
      {pending ? "Deleting…" : "Yes, delete this order"}
    </button>
  );
}

/**
 * Deleting an order is not undoable, so it takes two deliberate clicks and says
 * exactly what goes with it before the second one.
 */
export default function DeleteOrder({
  orderId,
  orderNo,
  counts,
  action,
}: {
  orderId: string;
  orderNo: string;
  counts: { islands: number; lines: number; payments: number; documents: number };
  action: (formData: FormData) => Promise<void>;
}) {
  const [asking, setAsking] = useState(false);

  if (!asking) {
    return (
      <button
        type="button"
        onClick={() => setAsking(true)}
        className="btn btn-ghost py-1 px-3 text-sm text-danger"
      >
        Delete order
      </button>
    );
  }

  const parts = [
    `${counts.islands} island${counts.islands === 1 ? "" : "s"}`,
    `${counts.lines} line${counts.lines === 1 ? "" : "s"}`,
    `${counts.payments} payment${counts.payments === 1 ? "" : "s"}`,
    `${counts.documents} document${counts.documents === 1 ? "" : "s"}`,
  ];

  return (
    <div className="card p-4 border-danger/50 w-full">
      <h3 className="font-semibold text-danger">Delete {orderNo}?</h3>
      <p className="text-sm text-muted mt-1">
        This cannot be undone. It removes {parts.join(", ")} and the whole activity
        log. The order number becomes free again, so the agreement can be
        re-imported.
      </p>
      <p className="text-sm text-muted mt-2">
        If the sale was real but fell through, cancel it instead — that keeps the
        record.
      </p>
      <div className="flex gap-2 mt-3">
        <form action={action}>
          <input type="hidden" name="orderId" value={orderId} />
          <ConfirmButton />
        </form>
        <button
          type="button"
          onClick={() => setAsking(false)}
          className="btn btn-ghost py-1 px-4 text-sm"
        >
          Keep it
        </button>
      </div>
    </div>
  );
}
