"use client";

import { useActionState } from "react";
import { runHistoricalBackfill, type HistoricalState } from "@/app/admin/sales-centers/actions";

export default function HistoricalBackfill() {
  const [state, action, pending] = useActionState<HistoricalState, FormData>(runHistoricalBackfill, {});
  return (
    <div className="card p-5 space-y-4">
      <div>
        <h2 className="font-semibold">Historical sales backfill</h2>
        <p className="text-xs text-muted mt-1">
          Pull a year of closed/billed orders for the sales dashboards. These are analytics-only —
          hidden from the order book, review queue and scheduling. Create-only: your live orders are
          never touched. Run the sample first to validate.
        </p>
      </div>
      <form action={action} className="flex items-end gap-3 flex-wrap">
        <label className="text-sm">
          <span className="text-muted">Year</span>
          <select name="year" defaultValue="2026" className="input mt-1">
            <option value="2024">2024</option>
            <option value="2025">2025</option>
            <option value="2026">2026</option>
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm pb-2">
          <input type="checkbox" name="sample" defaultChecked />
          <span>Sample (~200 orders)</span>
        </label>
        <button className="btn btn-primary text-sm" disabled={pending}>
          {pending ? "Backfilling…" : "Run backfill"}
        </button>
      </form>
      {state.message && (
        <p className={`text-sm ${state.ok ? "text-success" : "text-danger"}`}>{state.message}</p>
      )}
    </div>
  );
}
