"use client";

import { useActionState } from "react";
import {
  addPickAlias,
  deletePickAlias,
  type ActionState,
} from "@/app/inventory/actions";

export type AliasRow = {
  id: string;
  sourceItem: string;
  sourceDetail: string | null;
  category: string | null;
};

/**
 * Manage the scan aliases that resolve a scanned line to this product — the
 * hub-native learning loop for order/transfer/return line resolution. Managers
 * can add or remove; everyone sees the current list. Adding an alias whose key
 * already exists reassigns it to this product (a correction).
 */
export default function PickAliasEditor({
  productId,
  aliases,
  canManage,
}: {
  productId: string;
  aliases: AliasRow[];
  canManage: boolean;
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    addPickAlias,
    {}
  );

  return (
    <div className="card overflow-hidden">
      <div className="p-4 border-b border-border flex items-center gap-3">
        <h2 className="font-semibold">Scan aliases</h2>
        <span className="badge">{aliases.length}</span>
      </div>

      {aliases.length === 0 ? (
        <p className="px-4 py-4 text-sm text-muted">
          No scan aliases here yet. Scanned lines resolve to this product only
          once an alias exists.
        </p>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-muted text-left">
            <tr className="border-b border-border">
              <th className="px-4 py-2 font-medium">Item</th>
              <th className="px-4 py-2 font-medium">Detail</th>
              <th className="px-4 py-2 font-medium">Category</th>
              {canManage && <th className="px-4 py-2" />}
            </tr>
          </thead>
          <tbody>
            {aliases.map((a) => (
              <tr key={a.id} className="border-b border-border/50">
                <td className="px-4 py-2">{a.sourceItem}</td>
                <td className="px-4 py-2 text-muted">{a.sourceDetail ?? "—"}</td>
                <td className="px-4 py-2 text-muted">{a.category ?? "—"}</td>
                {canManage && (
                  <td className="px-4 py-2 text-right">
                    <form action={deletePickAlias} className="inline">
                      <input type="hidden" name="aliasId" value={a.id} />
                      <input type="hidden" name="productId" value={productId} />
                      <button type="submit" className="badge text-danger hover:border-danger/60">
                        Remove
                      </button>
                    </form>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {canManage && (
        <form action={formAction} className="p-4 border-t border-border space-y-3">
          <input type="hidden" name="productId" value={productId} />
          <div className="grid sm:grid-cols-3 gap-3">
            <label className="block text-sm">
              <span className="text-xs text-muted">Scan alias *</span>
              <input name="sourceItem" required className="input mt-1" />
            </label>
            <label className="block text-sm">
              <span className="text-xs text-muted">Alias detail</span>
              <input name="sourceDetail" className="input mt-1" />
            </label>
            <label className="block text-sm">
              <span className="text-xs text-muted">Category</span>
              <input name="category" className="input mt-1" />
            </label>
          </div>
          {state.message && (
            <p className={`text-sm ${state.ok ? "text-success" : "text-danger"}`}>
              {state.message}
            </p>
          )}
          <button type="submit" className="btn btn-ghost text-sm" disabled={pending}>
            {pending ? "Saving…" : "Add alias"}
          </button>
        </form>
      )}
    </div>
  );
}
