"use client";

import { useActionState } from "react";
import {
  adjustStockWithReason,
  type ActionState,
} from "@/app/inventory/actions";

export type AdjustWarehouse = {
  id: string;
  name: string;
  isDefaultWarehouse: boolean;
};

/**
 * Reason-required on-hand correction. Every adjustment writes an auditable
 * ADJUSTMENT ledger row whose note is the reason, so the movement history always
 * explains why a number changed. Pick the warehouse + condition the slot lives
 * in — getting that wrong would move one site's stock into another. MANAGER only.
 */
export default function AdjustStockForm({
  productId,
  warehouses,
  defaultWarehouseId,
}: {
  productId: string;
  warehouses: AdjustWarehouse[];
  defaultWarehouseId: string;
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    adjustStockWithReason,
    {}
  );

  return (
    <div className="card p-4 space-y-3">
      <h2 className="font-semibold">Adjust on-hand</h2>
      <p className="text-sm text-muted">
        Corrections are ledger rows, never overwrites — the history is kept. A
        reason is required.
      </p>
      <form action={formAction} className="space-y-3">
        <input type="hidden" name="productId" value={productId} />
        <div className="grid sm:grid-cols-2 gap-3 text-sm">
          <label className="block">
            <span className="text-xs text-muted">Warehouse</span>
            <select name="warehouseId" defaultValue={defaultWarehouseId} className="input mt-1">
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                  {w.isDefaultWarehouse ? " (default)" : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs text-muted">Condition</span>
            <select name="condition" defaultValue="NEW" className="input mt-1">
              <option value="NEW">New</option>
              <option value="SHOW_GOOD">Show good</option>
            </select>
          </label>
          <label className="block">
            <span className="text-xs text-muted">Mode</span>
            <select name="mode" defaultValue="delta" className="input mt-1">
              <option value="delta">Add / subtract (delta)</option>
              <option value="set">Set on-hand to…</option>
            </select>
          </label>
          <label className="block">
            <span className="text-xs text-muted">Amount</span>
            <input
              name="amount"
              type="number"
              defaultValue={0}
              className="input mt-1 text-right"
              required
            />
          </label>
        </div>
        <label className="block text-sm">
          <span className="text-xs text-muted">Reason *</span>
          <input
            name="reason"
            required
            placeholder="e.g. found damaged unit, cycle-count correction…"
            className="input mt-1"
          />
        </label>
        {state.message && (
          <p className={`text-sm ${state.ok ? "text-success" : "text-danger"}`}>
            {state.message}
          </p>
        )}
        <button type="submit" className="btn btn-primary text-sm" disabled={pending}>
          {pending ? "Applying…" : "Apply adjustment"}
        </button>
      </form>
    </div>
  );
}
