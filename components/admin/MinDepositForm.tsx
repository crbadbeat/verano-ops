"use client";

import { useActionState } from "react";
import { updateMinDeposit, type SettingsState } from "@/app/admin/settings/actions";

export default function MinDepositForm({ currentPct }: { currentPct: string }) {
  const [state, action, pending] = useActionState<SettingsState, FormData>(
    updateMinDeposit,
    {}
  );

  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <label className="block text-sm">
        <span className="text-xs text-muted">Minimum deposit %</span>
        <div className="mt-1 flex items-center gap-2">
          <input
            name="minDepositPct"
            type="number"
            step="0.01"
            min="0"
            max="100"
            defaultValue={currentPct}
            required
            className="input w-32"
          />
          <span className="text-muted">%</span>
        </div>
      </label>
      <button className="btn btn-primary" type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save"}
      </button>
      {state.message && (
        <span className={`text-sm ${state.ok ? "text-success" : "text-danger"}`}>
          {state.message}
        </span>
      )}
    </form>
  );
}
