import Link from "next/link";
import { notFound } from "next/navigation";
import { getViewer } from "@/lib/permissions/engine";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import SkuDatalist from "@/components/SkuDatalist";
import SignaturePad from "@/components/SignaturePad";
import {
  addTransferLine,
  removeTransferLine,
  mapTransferLine,
  departTransfer,
  receiveTransfer,
  cancelTransfer,
} from "../actions";
import type { TransferStatus } from "@prisma/client";

export const dynamic = "force-dynamic";

const STATUS_STYLE: Record<TransferStatus, string> = {
  STAGED: "text-teal",
  IN_TRANSIT: "text-ember",
  RECEIVED: "text-success",
  CANCELLED: "text-muted",
};

export default async function TransferDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await getViewer();
  const canManage = can(user, "transfers:edit");

  const transfer = await prisma.transfer.findUnique({
    where: { id },
    include: {
      destWarehouse: true,
      lines: {
        orderBy: { id: "asc" },
        include: { product: { select: { sku: true, displayName: true, name: true } } },
      },
    },
  });
  if (!transfer) notFound();

  const allSkus = await prisma.product.findMany({
    where: { active: true },
    select: { sku: true, displayName: true, name: true },
    orderBy: { sku: "asc" },
  });

  const staged = transfer.status === "STAGED";
  const unmatched = transfer.lines.filter((l) => !l.productId).length;
  const totalUnits = transfer.lines.reduce((s, l) => s + l.qty, 0);

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 space-y-6">
      <div className="flex items-center gap-3 flex-wrap">
        <Link href="/transfers" className="text-muted hover:text-foreground text-sm">
          ← Transfers
        </Link>
        <span className={`badge ${STATUS_STYLE[transfer.status]}`}>
          {transfer.status.replace("_", " ")}
        </span>
      </div>

      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          {transfer.reference ?? "Transfer"} → {transfer.destWarehouse.code}
        </h1>
        <p className="text-muted text-sm mt-1">
          {transfer.destWarehouse.name} · {transfer.lines.length} lines · {totalUnits}{" "}
          units
        </p>
      </div>

      <SkuDatalist id="all-skus" products={allSkus} />

      {staged && canManage && (
        <div className="card p-5 space-y-4">
          <h3 className="font-semibold">Add lines</h3>
          <form action={addTransferLine} className="flex flex-col sm:flex-row gap-2">
            <input type="hidden" name="transferId" value={transfer.id} />
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
              aria-label="Quantity"
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
        {transfer.lines.length === 0 ? (
          <div className="p-8 text-center text-muted text-sm">No lines yet.</div>
        ) : (
          <ul className="divide-y divide-border/50">
            {transfer.lines.map((l) => (
              <li key={l.id} className="flex items-center gap-2 px-4 py-2 text-sm flex-wrap">
                <span className="font-mono text-xs">
                  {l.product?.sku ?? l.itemLabel ?? "—"}
                  {!l.productId && <span className="text-danger"> (unmatched)</span>}
                </span>
                {l.orderNo && (
                  <span className="text-xs text-muted">#{l.orderNo}</span>
                )}
                <span className="ml-auto font-semibold tabular-nums">{l.qty}</span>
                {staged && canManage && !l.productId && (
                  <form action={mapTransferLine} className="flex items-center gap-1">
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
                {staged && canManage && (
                  <form action={removeTransferLine}>
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
            ))}
          </ul>
        )}
      </div>

      {/* Depart: QC + driver sign-off */}
      {staged && canManage && (
        <div className="card p-5 space-y-3">
          <h3 className="font-semibold">Depart</h3>
          <p className="text-sm text-muted">
            Confirm the load is QC&apos;d and complete. Departing relieves Ocoee and
            moves the stock into in-transit.
          </p>
          {unmatched > 0 && (
            <p className="text-sm text-danger">
              Map all unmatched lines before departing.
            </p>
          )}
          <form action={departTransfer} className="space-y-3">
            <input type="hidden" name="transferId" value={transfer.id} />
            <input
              name="driverName"
              placeholder="Driver name"
              required
              className="input"
            />
            <SignaturePad name="signatureData" />
            <button
              className="btn btn-primary w-full"
              type="submit"
              disabled={unmatched > 0 || transfer.lines.length === 0}
            >
              Depart &amp; relieve Ocoee
            </button>
          </form>
          <form action={cancelTransfer}>
            <input type="hidden" name="transferId" value={transfer.id} />
            <button className="btn btn-ghost text-danger w-full" type="submit">
              Cancel transfer
            </button>
          </form>
        </div>
      )}

      {/* Departed / received details */}
      {(transfer.status === "IN_TRANSIT" || transfer.status === "RECEIVED") && (
        <div className="card p-5 space-y-3">
          <h3 className="font-semibold">Sign-off</h3>
          <p className="text-sm text-muted">
            Driver <span className="text-foreground">{transfer.driverName ?? "—"}</span>{" "}
            · departed{" "}
            {transfer.departedAt?.toLocaleString("en-US", {
              dateStyle: "medium",
              timeStyle: "short",
            }) ?? "—"}
            {transfer.receivedAt &&
              ` · received ${transfer.receivedAt.toLocaleString("en-US", {
                dateStyle: "medium",
                timeStyle: "short",
              })}`}
          </p>
          {transfer.signatureData && (
            <div
              className="h-24 w-full max-w-xs rounded-lg border border-border bg-white bg-contain bg-no-repeat bg-center"
              style={{ backgroundImage: `url(${transfer.signatureData})` }}
              aria-label="Driver signature"
            />
          )}
          {transfer.status === "IN_TRANSIT" && (
            <form action={receiveTransfer}>
              <input type="hidden" name="transferId" value={transfer.id} />
              <button className="btn btn-primary w-full" type="submit">
                Receive at {transfer.destWarehouse.code}
              </button>
            </form>
          )}
        </div>
      )}

      {transfer.status === "CANCELLED" && (
        <div className="card p-5 text-sm text-muted">
          This transfer was cancelled before departing — no stock moved.
        </div>
      )}
    </div>
  );
}
