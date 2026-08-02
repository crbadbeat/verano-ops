"use client";

import { useActionState } from "react";
import {
  autoMapSalesCenters,
  backfillOrderSalesCenters,
  type SalesCenterState,
} from "@/app/admin/sales-centers/actions";

export default function SalesCenterTools() {
  const [mapState, mapAction, mapping] = useActionState<SalesCenterState, FormData>(
    autoMapSalesCenters,
    {}
  );
  const [fillState, fillAction, filling] = useActionState<SalesCenterState, FormData>(
    backfillOrderSalesCenters,
    {}
  );

  return (
    <div className="card p-5 space-y-4">
      <h2 className="font-semibold">Sync from NetSuite</h2>
      <div className="flex items-center gap-3 flex-wrap">
        <form action={mapAction}>
          <button className="btn btn-primary text-sm" disabled={mapping}>
            {mapping ? "Mapping…" : "Auto-map sales centers → showrooms"}
          </button>
        </form>
        <form action={fillAction}>
          <button className="btn btn-ghost text-sm" disabled={filling}>
            {filling ? "Backfilling…" : "Backfill sales center on existing orders"}
          </button>
        </form>
      </div>

      {mapState.message && (
        <div className={`text-sm ${mapState.ok ? "text-success" : "text-danger"}`}>
          <p>{mapState.message}</p>
          {mapState.unmatched && mapState.unmatched.length > 0 && (
            <div className="mt-2 text-muted">
              <p>Unmatched sales centers — map by hand below, or create the showroom Location:</p>
              <ul className="mt-1 grid sm:grid-cols-2 gap-x-4">
                {mapState.unmatched.map((u) => (
                  <li key={u.id}>
                    <span className="font-mono text-xs">{u.id}</span> {u.name}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
      {fillState.message && (
        <p className={`text-sm ${fillState.ok ? "text-success" : "text-danger"}`}>{fillState.message}</p>
      )}
    </div>
  );
}
