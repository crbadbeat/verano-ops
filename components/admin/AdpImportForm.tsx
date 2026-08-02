"use client";

import { useActionState } from "react";
import { uploadAdpEmployees, type ImportState } from "@/app/admin/employees/actions";

export default function AdpImportForm() {
  const [state, action, pending] = useActionState<ImportState, FormData>(uploadAdpEmployees, {});
  return (
    <form action={action} className="card p-5 space-y-4">
      <div>
        <h2 className="font-semibold">Import / sync from ADP</h2>
        <p className="text-xs text-muted mt-1">
          Upload the ADP employee-master export (.csv). Idempotent — re-uploading a fresh export keeps
          the roster current. Imports the current roster plus terminations from the last 12 months.
          Salary is loaded only for the allow-listed roles; the org chart you set here is preserved on
          re-sync.
        </p>
      </div>

      <input
        type="file"
        name="file"
        accept=".csv"
        required
        className="block text-sm file:mr-3 file:rounded file:border-0 file:bg-muted/30 file:px-3 file:py-1.5"
      />

      <button className="btn btn-primary text-sm" disabled={pending}>
        {pending ? "Importing…" : "Import"}
      </button>

      {state.message && (
        <div className={`text-sm ${state.ok ? "text-success" : "text-danger"}`}>
          <p>{state.message}</p>
          {state.summary && state.summary.unmatched.length > 0 && (
            <div className="mt-2 text-muted">
              <p>Home site left blank — these ADP locations aren’t in the WMS yet:</p>
              <ul className="mt-1 list-disc list-inside">
                {state.summary.unmatched.map((u) => (
                  <li key={u.name}>
                    {u.name} <span className="text-xs">×{u.count}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </form>
  );
}
