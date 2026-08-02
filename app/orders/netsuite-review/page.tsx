import Link from "next/link";
import { getViewer } from "@/lib/permissions/engine";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { netsuiteConfig } from "@/lib/netsuite";
import { getMinDepositBps } from "@/lib/settings";
import { depositGate } from "@/lib/deposit";
import {
  approveNetsuiteOrder,
  flagNetsuiteOrderForFix,
  syncNetsuiteOrdersNow,
} from "./actions";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 40;

function money(cents: number | null | undefined): string {
  return `$${((cents ?? 0) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default async function NetsuiteReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const user = await getViewer();
  if (!can(user, "orders.netsuite:approve")) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center text-muted">
        You don’t have access to the NetSuite order review queue.
      </div>
    );
  }

  const sp = await searchParams;

  // Count first so we can clamp the page and never fetch/render the whole queue.
  const [pending, needsFix, minDepositBps] = await Promise.all([
    prisma.order.count({ where: { source: "NETSUITE", netsuiteReviewStatus: "PENDING_REVIEW" } }),
    prisma.order.count({ where: { source: "NETSUITE", netsuiteReviewStatus: "NEEDS_NETSUITE_FIX" } }),
    getMinDepositBps(),
  ]);
  const total = pending + needsFix;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(totalPages, Math.max(1, Number(sp?.page ?? "1") || 1));

  const orders = await prisma.order.findMany({
    where: { source: "NETSUITE", netsuiteReviewStatus: { in: ["PENDING_REVIEW", "NEEDS_NETSUITE_FIX"] } },
    orderBy: [{ netsuiteReviewStatus: "asc" }, { createdAt: "desc" }],
    skip: (page - 1) * PAGE_SIZE,
    take: PAGE_SIZE,
    select: {
      id: true, orderNo: true, division: true, netsuiteReviewStatus: true, note: true,
      customerFirst: true, customerLast: true, email: true, phone: true,
      deliveryCity: true, deliveryState: true, deliveryZip: true,
      totalCents: true, salesTaxCents: true, freightCents: true, estCogsCents: true,
      depositReceivedCents: true, depositUnverifiedCents: true, customerOpenOrderCount: true,
      netsuiteSyncedAt: true,
      lines: { select: { productId: true } },
    },
  });

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 space-y-8">
      <div>
        <Link href="/orders" className="text-sm text-muted hover:underline">
          ← Orders
        </Link>
        <div className="flex items-center gap-3 mt-2 flex-wrap">
          <h1 className="text-3xl font-bold tracking-tight">NetSuite review queue</h1>
          <span className="badge text-muted">{pending} pending</span>
          {needsFix > 0 && <span className="badge text-ember">{needsFix} to fix in NetSuite</span>}
          <form action={syncNetsuiteOrdersNow} className="ml-auto">
            <button className="btn btn-ghost py-1 px-3 text-sm" type="submit" disabled={!netsuiteConfig()}>
              Sync now
            </button>
          </form>
        </div>
        <p className="text-muted mt-1">
          Sales orders pulled from NetSuite (PGI + PGD customer orders). Confirm each one — customer,
          delivery, lines and cost — then approve it into the order book, or flag it for a correction
          on the NetSuite side. COGS is estimated at the main-warehouse average cost and locked at ship.
        </p>
      </div>

      {total === 0 ? (
        <div className="card p-10 text-center text-muted">
          Nothing waiting — every synced order has been reviewed.
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between text-sm text-muted">
            <span>
              Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of {total}
            </span>
            <span>Page {page} / {totalPages}</span>
          </div>

          <ul className="space-y-4">
            {orders.map((o) => {
              const totalLines = o.lines.length;
              const matched = o.lines.filter((l) => l.productId).length;
              const unmatched = totalLines - matched;
              const needsFixFlag = o.netsuiteReviewStatus === "NEEDS_NETSUITE_FIX";
              const gate = depositGate(o.depositReceivedCents, o.totalCents, minDepositBps);
              const pctDown = gate.pctBps != null ? Math.floor(gate.pctBps / 100) : null;
              const unverified = o.depositReceivedCents == null && (o.customerOpenOrderCount ?? 0) > 1;
              return (
                <li key={o.id} className="card p-4 space-y-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Link href={`/orders/${o.id}`} className="font-mono font-semibold hover:underline">
                      {o.orderNo}
                    </Link>
                    <span className="badge text-muted text-xs">{o.division ?? "—"}</span>
                    {needsFixFlag && <span className="badge text-ember text-xs">Needs NetSuite fix</span>}
                    {unmatched > 0 && (
                      <span className="badge text-ember text-xs">{unmatched} unmatched line{unmatched === 1 ? "" : "s"}</span>
                    )}
                    {!gate.unknown && (
                      <span className={`badge text-xs ${gate.met ? "text-success" : "text-ember"}`}>
                        {pctDown ?? 0}% down{gate.met ? "" : " · under"}
                      </span>
                    )}
                    {unverified && (
                      <span className="badge text-ember text-xs">Multiple Open Orders ({o.customerOpenOrderCount})</span>
                    )}
                    <span className="ml-auto text-xs text-muted">
                      synced {o.netsuiteSyncedAt?.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }) ?? "—"}
                    </span>
                  </div>

                  <div className="grid gap-1 text-sm sm:grid-cols-2">
                    <div>
                      <span className="text-muted">Customer: </span>
                      {o.customerFirst ?? ""} {o.customerLast ?? ""}
                      {o.email ? <span className="text-muted"> · {o.email}</span> : null}
                      {o.phone ? <span className="text-muted"> · {o.phone}</span> : null}
                    </div>
                    <div>
                      <span className="text-muted">Deliver to: </span>
                      {[o.deliveryCity, o.deliveryState, o.deliveryZip].filter(Boolean).join(" ") || "—"}
                    </div>
                    <div className="text-muted">
                      Total {money(o.totalCents)} · tax {money(o.salesTaxCents)} · freight {money(o.freightCents)}
                    </div>
                    <div className="text-muted">
                      Est. COGS {money(o.estCogsCents)} · {matched}/{totalLines} lines matched
                    </div>
                    <div className="text-muted">
                      {unverified
                        ? `Deposit ${money(o.depositUnverifiedCents)} unverified · customer has ${o.customerOpenOrderCount} open orders`
                        : gate.unknown
                          ? "Deposit — not synced"
                          : `Deposit ${money(o.depositReceivedCents)} · ${pctDown ?? 0}% down${
                              !gate.met && gate.shortfallCents ? ` · needs ${money(gate.shortfallCents)} more` : ""
                            }`}
                    </div>
                  </div>

                  {o.note && needsFixFlag && <p className="text-xs text-ember">Fix note: {o.note}</p>}

                  <div className="flex items-end gap-3 flex-wrap pt-1 border-t border-border/60">
                    <form action={approveNetsuiteOrder}>
                      <input type="hidden" name="orderId" value={o.id} />
                      <button className="btn py-1 px-4 text-sm" type="submit">
                        Approve
                      </button>
                    </form>
                    <form action={flagNetsuiteOrderForFix} className="flex items-end gap-2">
                      <input type="hidden" name="orderId" value={o.id} />
                      <label className="text-xs text-muted flex flex-col gap-1">
                        What needs fixing in NetSuite?
                        <input name="note" placeholder="e.g. base config is generic" className="input text-sm py-1 w-64" />
                      </label>
                      <button className="btn btn-ghost py-1 px-3 text-sm" type="submit">
                        Flag for NetSuite
                      </button>
                    </form>
                  </div>
                </li>
              );
            })}
          </ul>

          <div className="flex items-center justify-between pt-2">
            {page > 1 ? (
              <Link href={`/orders/netsuite-review?page=${page - 1}`} className="btn btn-ghost py-1 px-3 text-sm">
                ← Previous
              </Link>
            ) : (
              <span />
            )}
            {page < totalPages ? (
              <Link href={`/orders/netsuite-review?page=${page + 1}`} className="btn btn-ghost py-1 px-3 text-sm">
                Next →
              </Link>
            ) : (
              <span />
            )}
          </div>
        </>
      )}
    </div>
  );
}
