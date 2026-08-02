import Link from "next/link";
import { notFound } from "next/navigation";
import { getViewer } from "@/lib/permissions/engine";
import { can } from "@/lib/rbac";
import { productDisplayName } from "@/lib/item-master";
import { prisma } from "@/lib/db";
import { onHandByProduct } from "@/lib/inventory";
import { computeShortfalls, stagingDateForLoadDate, isoDate } from "@/lib/scheduling";
import { getMinDepositBps } from "@/lib/settings";
import { depositGate } from "@/lib/deposit";
import {
  assignOrder,
  unassignOrder,
  finalizeTrip,
  unfinalizeTrip,
  cancelTrip,
  updateTrip,
  createGlassCutJob,
} from "../../actions";
import type { OrderType, TripStatus } from "@prisma/client";

export const dynamic = "force-dynamic";

const STATUS_TONE: Record<TripStatus, string> = {
  PLANNING: "text-muted",
  FINALIZED: "text-ember",
  CANCELLED: "text-danger",
  STAGING: "text-ember",
  STAGED: "text-ember",
  QC_PASSED: "text-teal",
  LOADED: "text-teal",
  DELIVERED: "text-success",
};

const TYPE_LABEL: Record<OrderType, string> = {
  CUSTOMER_DELIVERY: "Customer delivery",
  TRANSFER: "Transfer",
  SHOW: "Show",
  SERVICE: "Service",
};

function longDate(d: Date | null): string {
  return d
    ? d.toLocaleDateString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
      })
    : "—";
}

// Structural shape shared by assigned orders and add-panel candidates.
type OrderLineLike = {
  productId: string | null;
  sku: string | null;
  rawLabel: string | null;
  qty: number;
  product: { pickable: boolean; sku: string; name: string } | null;
};
function pickLinesOf(lines: OrderLineLike[]) {
  return lines
    .filter((l) => l.productId && l.product?.pickable)
    .map((l) => ({
      productId: l.productId as string,
      sku: l.product?.sku ?? l.sku ?? null,
      label: l.product ? productDisplayName(l.product) : l.rawLabel ?? l.sku ?? "item",
      qty: l.qty,
    }));
}
function customerName(o: { customerFirst: string | null; customerLast: string | null }): string {
  return [o.customerFirst, o.customerLast].filter(Boolean).join(" ") || "—";
}

export default async function TripDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const { id } = await params;
  const { q } = await searchParams;
  const user = await getViewer();
  const canManage = can(user, "scheduling:edit");

  const trip = await prisma.deliveryTrip.findUnique({
    where: { id },
    include: {
      orders: {
        orderBy: { orderNo: "asc" },
        include: {
          islands: {
            select: { id: true, styleCode: true, topSku: true, topProductId: true, topBlankSku: true },
          },
          lines: { include: { product: { select: { pickable: true, sku: true, displayName: true, name: true } } } },
        },
      },
    },
  });
  if (!trip) notFound();

  const planning = trip.status === "PLANNING";
  const onHand = await onHandByProduct();
  const minDepositBps = await getMinDepositBps();

  // Candidates for the add panel — confirmed, unscheduled, same type.
  const candidatesRaw =
    planning && canManage
      ? await prisma.order.findMany({
          where: {
            status: "CONFIRMED",
            deliveryTripId: null,
            type: trip.type,
            ...(q
              ? {
                  OR: [
                    { customerLast: { contains: q, mode: "insensitive" } },
                    { deliveryCity: { contains: q, mode: "insensitive" } },
                    { orderNo: { contains: q, mode: "insensitive" } },
                  ],
                }
              : {}),
          },
          orderBy: { createdAt: "desc" },
          take: 50,
          include: {
            lines: { include: { product: { select: { pickable: true, sku: true, displayName: true, name: true } } } },
          },
        })
      : [];

  // Hard deposit gate: a NetSuite-synced order that hasn't met the minimum
  // deposit is hidden from scheduling entirely (fails open only pre-sync).
  const candidates = candidatesRaw.filter(
    (o) =>
      o.source !== "NETSUITE" ||
      depositGate(o.depositReceivedCents, o.totalCents, minDepositBps).met
  );

  // Resolve blank SKUs on assigned islands so we can show blank on-hand.
  const blankSkus = [
    ...new Set(
      trip.orders.flatMap((o) => o.islands.map((i) => i.topBlankSku).filter(Boolean) as string[]),
    ),
  ];
  const blanks = blankSkus.length
    ? await prisma.product.findMany({ where: { sku: { in: blankSkus } }, select: { id: true, sku: true } })
    : [];
  const blankBySku = new Map(blanks.map((b) => [b.sku, b]));

  // Cut jobs already queued for these orders, so we don't offer a duplicate.
  const orderNos = trip.orders.map((o) => o.orderNo);
  const openMods = orderNos.length
    ? await prisma.glassMod.findMany({
        where: { orderNo: { in: orderNos }, status: { in: ["QUEUED", "IN_PROGRESS"] } },
        select: { orderNo: true, targetProductId: true },
      })
    : [];
  const queuedKey = new Set(openMods.map((m) => `${m.orderNo}|${m.targetProductId}`));

  const staging = stagingDateForLoadDate(trip.loadDate);
  const totalOrders = trip.orders.length;

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 space-y-6">
      <div className="flex items-center gap-3 flex-wrap">
        <Link href="/scheduling" className="text-muted hover:text-foreground text-sm">
          ← Scheduling
        </Link>
        <span className={`badge ${STATUS_TONE[trip.status]}`}>{trip.status}</span>
        <span className="badge text-muted">{TYPE_LABEL[trip.type]}</span>
      </div>

      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          {trip.name ?? `Trip · ${isoDate(trip.loadDate)}`}
        </h1>
        <p className="text-muted text-sm mt-1">
          Loads {longDate(trip.loadDate)} · stage by {longDate(staging)} ·{" "}
          {totalOrders} {totalOrders === 1 ? "stop" : "stops"}
          {trip.area ? ` · ${trip.area}` : ""}
        </p>
      </div>

      {/* Trip controls */}
      {canManage && (
        <div className="card p-5 space-y-4">
          {planning ? (
            <>
              <div className="flex items-center gap-2 flex-wrap">
                <form action={finalizeTrip}>
                  <input type="hidden" name="tripId" value={trip.id} />
                  <button className="btn btn-primary" type="submit" disabled={totalOrders === 0}>
                    Finalize → warehouse
                  </button>
                </form>
                <form action={cancelTrip}>
                  <input type="hidden" name="tripId" value={trip.id} />
                  <button className="btn btn-ghost text-danger" type="submit">
                    Cancel trip
                  </button>
                </form>
              </div>
              {totalOrders === 0 && (
                <p className="text-sm text-muted">Add at least one order before finalizing.</p>
              )}
              <details className="border-t border-border pt-3">
                <summary className="text-sm text-muted cursor-pointer">Edit trip</summary>
                <form action={updateTrip} className="mt-3 grid gap-3 sm:grid-cols-2">
                  <input type="hidden" name="tripId" value={trip.id} />
                  <label className="text-sm text-muted space-y-1 block">
                    <span>Load date</span>
                    <input
                      name="loadDate"
                      type="date"
                      defaultValue={isoDate(trip.loadDate)}
                      className="input w-full"
                    />
                  </label>
                  <label className="text-sm text-muted space-y-1 block">
                    <span>Name</span>
                    <input name="name" defaultValue={trip.name ?? ""} className="input w-full" />
                  </label>
                  <label className="text-sm text-muted space-y-1 block sm:col-span-2">
                    <span>Area</span>
                    <input name="area" defaultValue={trip.area ?? ""} className="input w-full" />
                  </label>
                  <button className="btn btn-ghost sm:col-span-2" type="submit">
                    Save changes
                  </button>
                </form>
              </details>
            </>
          ) : trip.status === "FINALIZED" ? (
            <div className="flex items-center gap-3 flex-wrap">
              <p className="text-sm text-muted">
                Finalized — dropped to the warehouse to be picked and staged.
              </p>
              <form action={unfinalizeTrip} className="ml-auto">
                <input type="hidden" name="tripId" value={trip.id} />
                <button className="btn btn-ghost" type="submit">
                  Re-open for changes
                </button>
              </form>
            </div>
          ) : (
            <p className="text-sm text-muted">This trip is {trip.status.toLowerCase()}.</p>
          )}
        </div>
      )}

      {/* Stops */}
      <div className="card overflow-hidden">
        <div className="p-4 border-b border-border flex items-center gap-3">
          <h2 className="font-semibold">Stops</h2>
          <span className="badge text-muted">{totalOrders}</span>
        </div>
        {totalOrders === 0 ? (
          <div className="p-8 text-center text-muted text-sm">
            No orders on this trip yet.
          </div>
        ) : (
          <ul className="divide-y divide-border/60">
            {trip.orders.map((o) => {
              const shortfalls = computeShortfalls(pickLinesOf(o.lines), onHand);
              const glassRows = o.islands
                .map((i) => {
                  if (!i.topBlankSku) return null;
                  const blank = blankBySku.get(i.topBlankSku);
                  const blankOnHand = blank ? onHand.get(blank.id) ?? 0 : 0;
                  const topOnHand = i.topProductId ? onHand.get(i.topProductId) ?? 0 : 0;
                  const queued = i.topProductId
                    ? queuedKey.has(`${o.orderNo}|${i.topProductId}`)
                    : false;
                  if (topOnHand >= 1 && !queued) return null; // top already in stock
                  return { island: i, blankOnHand, topOnHand, queued, blankExists: !!blank };
                })
                .filter(Boolean);

              return (
                <li key={o.id} className="px-4 py-3 space-y-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Link href={`/orders/${o.id}`} className="font-mono text-sm hover:underline">
                      {o.orderNo}
                    </Link>
                    <span className="text-sm">{customerName(o)}</span>
                    {(o.deliveryCity || o.deliveryState) && (
                      <span className="text-xs text-muted">
                        {[o.deliveryCity, o.deliveryState].filter(Boolean).join(", ")}
                      </span>
                    )}
                    {o.fraudCheckStatus === "REQUIRED" && (
                      <span className="badge text-danger">fraud check</span>
                    )}
                    {canManage && planning && (
                      <form action={unassignOrder} className="ml-auto">
                        <input type="hidden" name="orderId" value={o.id} />
                        <button
                          type="submit"
                          className="text-muted hover:text-danger text-xs px-1"
                          aria-label="Remove from trip"
                        >
                          ✕ remove
                        </button>
                      </form>
                    )}
                  </div>

                  {/* Finished-goods availability */}
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {shortfalls.length === 0 ? (
                      <span className="badge text-success">all pickable stock on hand</span>
                    ) : (
                      shortfalls.map((s) => (
                        <span key={s.productId} className="badge text-danger" title={s.label}>
                          {s.sku ?? s.label} short {s.short}
                        </span>
                      ))
                    )}
                  </div>

                  {/* Glass to cut */}
                  {glassRows.map((g) => (
                    <div
                      key={g!.island.id}
                      className="flex items-center gap-2 flex-wrap text-xs rounded-lg bg-surface-2 px-3 py-2"
                    >
                      <span className="font-mono text-teal">{g!.island.topSku}</span>
                      <span className="text-muted">
                        cut from{" "}
                        <span className="font-mono">{g!.island.topBlankSku}</span>
                        {g!.blankExists
                          ? ` · ${g!.blankOnHand} blank${g!.blankOnHand === 1 ? "" : "s"} on hand`
                          : " · blank not a product here"}
                      </span>
                      {g!.queued ? (
                        <span className="badge text-ember ml-auto">cut queued</span>
                      ) : (
                        canManage && (
                          <form action={createGlassCutJob} className="ml-auto">
                            <input type="hidden" name="islandId" value={g!.island.id} />
                            <input type="hidden" name="tripId" value={trip.id} />
                            <button
                              className="btn btn-ghost py-1 px-2 text-xs"
                              type="submit"
                              disabled={!g!.blankExists}
                            >
                              Create cut job
                            </button>
                          </form>
                        )
                      )}
                    </div>
                  ))}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Add orders */}
      {planning && canManage && (
        <div className="card p-5 space-y-4">
          <div className="flex items-center gap-3">
            <h2 className="font-semibold">Add orders</h2>
            <span className="badge text-muted">{candidates.length}</span>
          </div>
          <form method="get" className="flex gap-2">
            <input
              name="q"
              defaultValue={q ?? ""}
              placeholder="Filter by customer, city or order #"
              className="input flex-1"
            />
            <button className="btn btn-ghost" type="submit">
              Filter
            </button>
          </form>

          {candidates.length === 0 ? (
            <p className="text-sm text-muted">
              No confirmed {TYPE_LABEL[trip.type].toLowerCase()} orders waiting to be scheduled
              {q ? " for that filter" : ""}.
            </p>
          ) : (
            <ul className="divide-y divide-border/60">
              {candidates.map((c) => {
                const shortfalls = computeShortfalls(pickLinesOf(c.lines), onHand);
                const needsNote = shortfalls.length > 0 || c.fraudCheckStatus === "REQUIRED";
                return (
                  <li key={c.id} className="py-3 space-y-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Link href={`/orders/${c.id}`} className="font-mono text-sm hover:underline">
                        {c.orderNo}
                      </Link>
                      <span className="text-sm">{customerName(c)}</span>
                      {(c.deliveryCity || c.deliveryState) && (
                        <span className="text-xs text-muted">
                          {[c.deliveryCity, c.deliveryState].filter(Boolean).join(", ")}
                        </span>
                      )}
                      {c.fraudCheckStatus === "REQUIRED" && (
                        <span className="badge text-danger">fraud check</span>
                      )}
                      {shortfalls.length > 0 && (
                        <span className="badge text-danger">
                          short {shortfalls.length} item{shortfalls.length === 1 ? "" : "s"}
                        </span>
                      )}
                    </div>
                    <form action={assignOrder} className="flex gap-2 flex-wrap items-start">
                      <input type="hidden" name="tripId" value={trip.id} />
                      <input type="hidden" name="orderId" value={c.id} />
                      {needsNote && (
                        <input
                          name="note"
                          required
                          placeholder={
                            shortfalls.length > 0
                              ? "Reason to schedule despite the shortfall"
                              : "Note (billing ≠ delivery — fraud check)"
                          }
                          className="input flex-1 min-w-[220px]"
                        />
                      )}
                      <button className="btn btn-ghost whitespace-nowrap" type="submit">
                        Add to trip
                      </button>
                    </form>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
