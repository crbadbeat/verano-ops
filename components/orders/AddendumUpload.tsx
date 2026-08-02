"use client";

import { useActionState, useState } from "react";
import type { OrderIntakeState } from "@/app/orders/actions";
import { tooLargeMessage } from "./upload-limit";

export default function AddendumUpload({
  orderId,
  action,
}: {
  orderId: string;
  action: (prev: OrderIntakeState, formData: FormData) => Promise<OrderIntakeState>;
}) {
  const [state, formAction, pending] = useActionState<OrderIntakeState, FormData>(
    action,
    {}
  );
  const [sizeError, setSizeError] = useState<string | null>(null);

  return (
    <div className="card p-5">
      <h3 className="font-semibold">Apply an addendum</h3>
      <p className="text-sm text-muted mt-1">
        Upload the re-issued agreement. The islands and everything they configure
        are rebuilt from it; lines you added by hand are kept.
      </p>
      <form
        action={formAction}
        onSubmit={(e) => {
          const problem = tooLargeMessage(e.currentTarget);
          setSizeError(problem);
          if (problem) e.preventDefault();
        }}
        className="mt-4 flex flex-col sm:flex-row gap-3"
      >
        <input type="hidden" name="orderId" value={orderId} />
        <input
          type="file"
          name="file"
          accept=".pdf"
          required
          onChange={() => setSizeError(null)}
          className="input file:mr-3 file:rounded-md file:border-0 file:bg-surface-2 file:px-3 file:py-1 file:text-foreground"
        />
        <button className="btn btn-primary whitespace-nowrap" type="submit" disabled={pending}>
          {pending ? "Applying…" : "Apply addendum"}
        </button>
      </form>
      {sizeError && <p className="mt-3 text-sm text-danger">{sizeError}</p>}

      {state?.message && (
        <p className={`mt-3 text-sm ${state.ok ? "text-success" : "text-danger"}`}>
          {state.message}
        </p>
      )}
      {state?.warnings && state.warnings.length > 0 && (
        <details className="mt-2 text-sm text-muted">
          <summary className="cursor-pointer">
            {state.warnings.length} thing(s) to check
          </summary>
          <ul className="mt-2 list-disc pl-5 space-y-1">
            {state.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
