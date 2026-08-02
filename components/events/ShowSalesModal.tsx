"use client";

import { useEffect, useState } from "react";
import { moneyFloor } from "@/lib/reporting/format";
import type { SaleLine } from "@/lib/reporting/shows";
import RepAvatar from "@/components/employees/RepAvatar";

/**
 * A roomy modal listing every sale on a show. Rendered on each ShowStatCard in
 * place of the old cramped inline <details>; the card stays a server component
 * and this is the only client island. State-driven overlay (not a native
 * <dialog>) so the backdrop + card can be styled with app tokens. Closes on the
 * ✕, a backdrop click, or Escape.
 */
export default function ShowSalesModal({ sales, showName }: { sales: SaleLine[]; showName: string }) {
  const [open, setOpen] = useState(false);
  const label = `${sales.length} ${sales.length === 1 ? "sale" : "sales"}`;

  // While open: close on Escape and lock body scroll. setState runs inside the
  // listener, not the effect body, so this is not a set-state-in-effect.
  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="text-sm text-teal hover:underline">
        View {sales.length} {sales.length === 1 ? "sale" : "sales"}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={showName}
            onClick={(event) => event.stopPropagation()}
            className="card max-w-4xl w-full max-h-[85vh] overflow-hidden flex flex-col"
          >
            {/* Header */}
            <div className="flex items-start gap-3 p-5 border-b border-border">
              <div className="min-w-0">
                <h2 className="font-semibold leading-tight truncate">{showName}</h2>
                <p className="text-xs text-muted mt-0.5 tabular-nums">{label}</p>
              </div>
              <button
                type="button"
                aria-label="Close"
                onClick={() => setOpen(false)}
                className="ml-auto shrink-0 rounded-lg px-2 py-1 text-lg leading-none text-muted hover:bg-surface-2 hover:text-foreground"
              >
                <span aria-hidden>✕</span>
              </button>
            </div>

            {/* Body — scrollable sales table */}
            <div className="flex-1 min-h-0 overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-muted bg-surface-2/40 border-b border-border">
                  <tr>
                    <th className="py-2 px-3 font-medium">Sold</th>
                    <th className="py-2 px-3 font-medium">Rep</th>
                    <th className="py-2 px-3 font-medium">Customer</th>
                    <th className="py-2 px-3 font-medium">Product</th>
                    <th className="py-2 px-3 font-medium">Price list</th>
                    <th className="py-2 px-3 font-medium text-right">Price</th>
                  </tr>
                </thead>
                <tbody>
                  {sales.map((sale) => (
                    <tr key={sale.id} className="border-b border-border/40 last:border-b-0">
                      <td className="py-2 px-3 whitespace-nowrap tabular-nums">{sale.soldAt ?? "—"}</td>
                      <td className="py-2 px-3 whitespace-nowrap">
                        <span className="inline-flex items-center gap-2">
                          <RepAvatar id={sale.repId} name={sale.repName} size={24} />
                          <span>
                            {sale.repName}
                            {sale.secondRepName && <span className="text-muted"> +{sale.secondRepName}</span>}
                          </span>
                        </span>
                      </td>
                      <td className="py-2 px-3 whitespace-nowrap">{sale.customer}</td>
                      <td className="py-2 px-3">
                        {sale.product}
                        <span className="text-muted"> · {sale.saleType}</span>
                      </td>
                      <td className="py-2 px-3 text-muted whitespace-nowrap">{sale.priceList}</td>
                      <td className="py-2 px-3 text-right tabular-nums whitespace-nowrap">{moneyFloor(sale.amountCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
