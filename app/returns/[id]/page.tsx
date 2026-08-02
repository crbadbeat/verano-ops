import Link from "next/link";
import { notFound } from "next/navigation";
import { getViewer } from "@/lib/permissions/engine";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import SkuDatalist from "@/components/SkuDatalist";
import { remainingToCheckIn } from "@/lib/transfers";
import {
  addReturnLine,
  removeReturnLine,
  mapReturnLine,
  checkInReturn,
  closeReturn,
  cancelReturn,
} from "../actions";

export const dynamic = "force-dynamic";

export default async function ReturnDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await getViewer();
  const canCheckIn = can(user, "returns:edit");

  const ret = await prisma.returnOrder.findUnique({
    where: { id },
    include: {
      lines: {
        orderBy: { id: "asc" },
        include: { product: { select: { sku: true, displayName: true, name: true } } },
      },
    },
  });
  if (!ret) notFound();

  const allSkus = await prisma.product.findMany({
    where: { active: true },
    select: { sku: true, displayName: true, name: true },
    orderBy: { sku: "asc" },
  });

  const open = ret.status === "FLAGGED";
  const unmatched = ret.lines.filter((l) => !l.productId).length;
  const expected = ret.lines.reduce((s, l) => s + l.expectedQty, 0);
  const gotBack = ret.lines.reduce((s, l) => s + l.checkedInQty, 0);
  const short = expected - gotBack;
  const outstanding = ret.lines.filter(
    (l) => remainingToCheckIn(l.expectedQty, l.checkedInQty) > 0
  );

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 space-y-6">
      <div className="flex items-center gap-3 flex-wrap">
        <Link href="/returns" className="text-muted hover:text-foreground text-sm">
          ← Returns
        </Link>
        <span
          className={`badge ${
            ret.status === "CHECKED_IN"
              ? "text-success"
              : ret.status === "CANCELLED"
                ? "text-muted"
                : "text-ember"
          }`}
        >
          {ret.status.replace("_", " ")}
        </span>
      </div>

      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          {ret.reference ?? "Return"}
        </h1>
        <p className="text-muted text-sm mt-1">
          {ret.reason ?? "—"} · {gotBack}/{expected} back
          {short > 0 && <span className="text-danger"> · {short} short</span>}
        </p>
      </div>

      <SkuDatalist id="all-skus" products={allSkus} />

      {open && (
        <div className="card p-5 space-y-4">
          <h3 className="font-semibold">What went out</h3>
          <form action={addReturnLine} className="flex flex-col sm:flex-row gap-2">
            <input type="hidden" name="returnOrderId" value={ret.id} />
            <input
              name="sku"
              list="all-skus"
              placeholder="SKU"
              required
              className="input font-mono"
            />
            <input
              name="qty"
              type="number"
              min={1}
              defaultValue={1}
              className="input sm:max-w-[100px]"
              aria-label="Expected quantity"
            />
            <button className="btn btn-ghost whitespace-nowrap" type="submit">
              Add line
            </button>
          </form>
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="p-4 border-b border-border flex items-center gap-3">
          <h3 className="font-semibold">Lines</h3>
          {unmatched > 0 && (
            <span className="badge text-danger">{unmatched} unmatched</span>
          )}
        </div>
        {ret.lines.length === 0 ? (
          <div className="p-8 text-center text-muted text-sm">No lines yet.</div>
        ) : (
          <ul className="divide-y divide-border/50">
            {ret.lines.map((l) => {
              const rem = remainingToCheckIn(l.expectedQty, l.checkedInQty);
              return (
                <li
                  key={l.id}
                  className="flex items-center gap-2 px-4 py-2 text-sm flex-wrap"
                >
                  <span className="font-mono text-xs">
                    {l.product?.sku ?? l.itemLabel ?? "—"}
                    {!l.productId && <span className="text-danger"> (unmatched)</span>}
                  </span>
                  {l.orderNo && <span className="text-xs text-muted">#{l.orderNo}</span>}
                  <span className="ml-auto text-xs text-muted tabular-nums">
                    {l.checkedInQty}/{l.expectedQty}
                    {rem > 0 && <span className="text-danger"> · {rem} out</span>}
                  </span>
                  {open && !l.productId && (
                    <form action={mapReturnLine} className="flex items-center gap-1">
                      <input type="hidden" name="lineId" value={l.id} />
                      <input
                        name="sku"
                        list="all-skus"
                        placeholder="pick SKU…"
                        required
                        className="input py-1 max-w-[180px]"
                      />
                      <button className="btn btn-ghost py-1 px-2 text-xs" type="submit">
                        Map
                      </button>
                    </form>
                  )}
                  {open && l.checkedInQty === 0 && (
                    <form action={removeReturnLine}>
                      <input type="hidden" name="lineId" value={l.id} />
                      <button
                        type="submit"
                        className="text-muted hover:text-danger text-xs px-1"
                        aria-label="Remove line"
                      >
                        ✕
                      </button>
                    </form>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {open && canCheckIn && outstanding.length > 0 && (
        <div className="card p-5 space-y-3">
          <h3 className="font-semibold">Check in what came back</h3>
          {unmatched > 0 ? (
            <p className="text-sm text-danger">Map all unmatched lines first.</p>
          ) : (
            <form action={checkInReturn} className="space-y-2">
              <input type="hidden" name="returnOrderId" value={ret.id} />
              {outstanding.map((l) => {
                const rem = remainingToCheckIn(l.expectedQty, l.checkedInQty);
                return (
                  <div key={l.id} className="flex items-center gap-2 text-sm">
                    <span className="font-mono text-xs truncate">
                      {l.product?.sku ?? l.itemLabel}
                    </span>
                    <span className="text-xs text-muted ml-auto">{rem} out</span>
                    <input
                      name={`qty_${l.id}`}
                      type="number"
                      min={0}
                      max={rem}
                      defaultValue={rem}
                      className="input w-20 py-1"
                      aria-label={`Received ${l.product?.sku ?? l.itemLabel}`}
                    />
                  </div>
                );
              })}
              <button className="btn btn-primary w-full" type="submit">
                Check in
              </button>
            </form>
          )}
        </div>
      )}

      {open && canCheckIn && (
        <div className="flex gap-2 flex-wrap">
          {ret.lines.length > 0 && (
            <form action={closeReturn}>
              <input type="hidden" name="returnOrderId" value={ret.id} />
              <button className="btn btn-ghost" type="submit">
                Close with shortfall
              </button>
            </form>
          )}
          <form action={cancelReturn} className="ml-auto">
            <input type="hidden" name="returnOrderId" value={ret.id} />
            <button className="btn btn-ghost text-danger" type="submit">
              Cancel
            </button>
          </form>
        </div>
      )}

      {ret.status === "CHECKED_IN" && (
        <div className="card p-5 text-sm">
          <span className="text-muted">
            Closed{" "}
            {ret.checkedInAt?.toLocaleString("en-US", {
              dateStyle: "medium",
              timeStyle: "short",
            })}
            .{" "}
          </span>
          {short > 0 ? (
            <span className="text-danger">
              {short} unit(s) never came back — recorded as a shortfall.
            </span>
          ) : (
            <span className="text-success">Everything came back.</span>
          )}
        </div>
      )}
    </div>
  );
}
