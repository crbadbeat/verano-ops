import Link from "next/link";
import { notFound } from "next/navigation";
import { getViewer } from "@/lib/permissions/engine";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { pickCategory, sortSourcesByLocation, summarizePick, type PickBucket } from "@/lib/picking";
import { stagingDateForLoadDate, isoDate } from "@/lib/scheduling";
import { productDisplayName } from "@/lib/item-master";
import PickClient from "@/components/staging/PickClient";
import TripStageNav from "@/components/staging/TripStageNav";
import StatusChip from "@/components/ui/StatusChip";
import { undoLastPick } from "../actions";

export const dynamic = "force-dynamic";

const BUCKET_LABEL: Record<PickBucket, string> = {
  BASE: "Bases",
  GLASS: "Glass",
  APPLIANCE: "Appliances",
  OTHER: "Other",
};

function longDate(d: Date): string {
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}

export default async function DirectedPickPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ cat?: string }>;
}) {
  const { id } = await params;
  const { cat: catParam } = await searchParams;
  const user = await getViewer();
  const canPick = can(user, "staging:pick");

  const trip = await prisma.deliveryTrip.findUnique({
    where: { id },
    include: {
      lanes: { orderBy: { position: "asc" }, include: { lane: { select: { code: true, name: true } } } },
      orders: {
        include: {
          lines: {
            include: {
              product: {
                select: {
                  id: true,
                  sku: true,
                  displayName: true,
                  name: true,
                  category: true,
                  pickable: true,
                },
              },
            },
          },
        },
      },
    },
  });
  if (!trip) notFound();

  // Needed = pickable order lines aggregated by product.
  const neededByProduct = new Map<
    string,
    { product: { id: string; sku: string; name: string; category: string | null }; needed: number }
  >();
  for (const o of trip.orders) {
    for (const l of o.lines) {
      if (!l.productId || !l.product?.pickable) continue;
      const cur = neededByProduct.get(l.productId);
      if (cur) cur.needed += l.qty;
      else neededByProduct.set(l.productId, { product: l.product, needed: l.qty });
    }
  }
  const neededList = [...neededByProduct.values()];
  const productIds = neededList.map((n) => n.product.id);
  const laneIds = trip.lanes.map((l) => l.laneId);

  // Staged = net trip ledger at the lane(s); source bins = per-bin NEW stock.
  const [stagedRows, stockRows] = await Promise.all([
    laneIds.length
      ? prisma.inventoryLedger.groupBy({
          by: ["productId"],
          where: { tripId: trip.id, locationId: { in: laneIds } },
          _sum: { qtyDelta: true },
        })
      : Promise.resolve([]),
    productIds.length
      ? prisma.inventoryLedger.groupBy({
          by: ["productId", "locationId"],
          where: { productId: { in: productIds }, condition: "NEW" },
          _sum: { qtyDelta: true },
        })
      : Promise.resolve([]),
  ]);
  const stagedByProduct = new Map(stagedRows.map((r) => [r.productId, r._sum.qtyDelta ?? 0]));

  const binIds = [...new Set(stockRows.map((r) => r.locationId).filter((x): x is string => !!x))];
  const bins = binIds.length
    ? await prisma.location.findMany({
        where: { id: { in: binIds } },
        select: { id: true, code: true, aisle: true, bay: true, level: true, isStagingLane: true },
      })
    : [];
  const binById = new Map(bins.map((b) => [b.id, b]));

  const sourcesByProduct = new Map<
    string,
    { code: string; qty: number; aisle: string | null; bay: string | null; level: number | null }[]
  >();
  for (const r of stockRows) {
    const qty = r._sum.qtyDelta ?? 0;
    if (qty <= 0 || !r.locationId) continue; // storage bins only (skip warehouse-level + lanes)
    const bin = binById.get(r.locationId);
    if (!bin || bin.isStagingLane) continue;
    const arr = sourcesByProduct.get(r.productId) ?? [];
    arr.push({ code: bin.code, qty, aisle: bin.aisle, bay: bin.bay, level: bin.level });
    sourcesByProduct.set(r.productId, arr);
  }
  for (const [pid, arr] of sourcesByProduct) sourcesByProduct.set(pid, sortSourcesByLocation(arr));

  const progress = summarizePick(
    neededList.map((n) => ({ productId: n.product.id, needed: n.needed })),
    stagedByProduct
  );
  const progressByProduct = new Map(progress.lines.map((l) => [l.productId, l]));

  // Category tabs — the picker works one type at a time.
  const buckets: PickBucket[] = ["BASE", "GLASS", "APPLIANCE", "OTHER"];
  const countByBucket = new Map<PickBucket, number>();
  for (const n of neededList) {
    const b = pickCategory(n.product.category);
    countByBucket.set(b, (countByBucket.get(b) ?? 0) + 1);
  }
  const available = buckets.filter((b) => (countByBucket.get(b) ?? 0) > 0);
  const cat = (catParam as PickBucket) ?? available[0] ?? "BASE";
  const rows = neededList
    .filter((n) => pickCategory(n.product.category) === cat)
    .sort((a, b) => a.product.sku.localeCompare(b.product.sku));

  const staging = trip.status === "STAGING";
  const stageBy = stagingDateForLoadDate(trip.loadDate);
  const primaryLaneCode = trip.lanes[0]?.lane.code ?? null;

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 space-y-6">
      <div className="flex items-center gap-3 flex-wrap">
        <Link href="/staging" className="text-muted hover:text-foreground text-sm">
          ← Pick queue
        </Link>
        <StatusChip status={trip.status} />
      </div>

      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          {trip.name ?? `Trip · ${isoDate(trip.loadDate)}`}
        </h1>
        <p className="text-muted text-sm mt-1">
          Loads {longDate(trip.loadDate)} · stage by {longDate(stageBy)} ·{" "}
          {trip.orders.length} {trip.orders.length === 1 ? "stop" : "stops"}
          {progress.shortCount > 0 && (
            <span className="text-danger"> · {progress.shortCount} short</span>
          )}
        </p>
      </div>

      <TripStageNav tripId={trip.id} active="pick" />

      {/* Lanes (read-only here; assigned in Stage & confirm) */}
      <div className="card p-4 flex items-center gap-2 flex-wrap">
        <h2 className="font-semibold text-sm">Lanes</h2>
        {trip.lanes.length > 0 ? (
          trip.lanes.map((l, i) => (
            <span key={l.id} className={`badge font-mono ${i === 0 ? "text-teal" : "text-muted"}`}>
              {l.lane.code.replace("LANE-", "")}
              {i === 0 ? " (primary)" : ""}
            </span>
          ))
        ) : (
          <span className="text-sm text-muted">
            No lane yet —{" "}
            <Link href={`/staging/${trip.id}/confirm`} className="text-ember underline">
              a manager assigns lanes in Stage &amp; confirm
            </Link>
            .
          </span>
        )}
      </div>

      {/* QC bounced it back — show the picker what to fix */}
      {staging && trip.qcNote && (
        <div className="card p-4 border-danger/40 text-sm">
          <span className="text-danger font-semibold">Sent back by QC:</span> {trip.qcNote}
        </div>
      )}

      {/* Status banner when this trip is not in the picking window */}
      {!staging && (
        <div className="card p-5 text-sm text-muted">
          {trip.status === "FINALIZED"
            ? "Not started. A manager assigns lanes in Stage & confirm to open picking."
            : trip.status === "STAGED"
              ? "Picking is complete and the trip is staged."
              : trip.status === "PLANNING"
                ? "This trip is still being built in Scheduling."
                : `This trip has moved on (${trip.status.toLowerCase()}).`}{" "}
          <Link href={`/staging/${trip.id}/confirm`} className="text-ember underline">
            Go to Stage &amp; confirm
          </Link>
          .
        </div>
      )}

      {/* Category tabs */}
      {available.length > 0 && (
        <div className="flex gap-1 rounded-xl bg-surface-2 p-1">
          {available.map((b) => (
            <Link
              key={b}
              href={`/staging/${trip.id}?cat=${b}`}
              className={`flex-1 text-center rounded-lg py-2 text-sm font-medium ${
                cat === b ? "bg-ember text-[#1a1206]" : "text-muted hover:text-foreground"
              }`}
            >
              {BUCKET_LABEL[b]} · {countByBucket.get(b)}
            </Link>
          ))}
        </div>
      )}

      {/* Scan-pick */}
      {staging && canPick && (
        <PickClient tripId={trip.id} category={cat} primaryLaneCode={primaryLaneCode} />
      )}

      {/* Pick list for the active category */}
      <div className="card overflow-hidden">
        <div className="p-4 border-b border-border flex items-center gap-3">
          <h2 className="font-semibold">{BUCKET_LABEL[cat]} to pick</h2>
          <span className="badge text-muted">{rows.length}</span>
        </div>
        {rows.length === 0 ? (
          <div className="p-8 text-center text-muted text-sm">Nothing in this category.</div>
        ) : (
          <ul className="divide-y divide-border/60">
            {rows.map((n) => {
              const p = progressByProduct.get(n.product.id);
              const remaining = p?.remaining ?? n.needed;
              const stagedQty = p?.staged ?? 0;
              const sources = sourcesByProduct.get(n.product.id) ?? [];
              return (
                <li key={n.product.id} className="px-4 py-3 space-y-1.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Link
                      href={`/inventory/${n.product.id}`}
                      className="font-mono text-xs hover:underline"
                    >
                      {n.product.sku}
                    </Link>
                    <span className="text-sm truncate">{productDisplayName(n.product)}</span>
                    <span className="ml-auto text-xs tabular-nums">
                      <span className={remaining === 0 ? "text-success" : "text-muted"}>
                        {stagedQty}/{n.needed} staged
                      </span>
                      {remaining > 0 && <span className="text-danger"> · {remaining} to go</span>}
                    </span>
                  </div>
                  <div className="text-xs text-muted flex items-center gap-2 flex-wrap">
                    <span>from</span>
                    {sources.length === 0 ? (
                      <span className="text-danger">not in a bin yet</span>
                    ) : (
                      sources.slice(0, 6).map((s) => (
                        <span key={s.code} className="font-mono">
                          {s.code}
                          <span className="text-muted/70"> ({s.qty})</span>
                        </span>
                      ))
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Fix a mis-scan; declaring the trip staged happens in Stage & confirm */}
      {staging && canPick && (
        <div className="flex items-center gap-3 flex-wrap">
          <Link href={`/staging/${trip.id}/confirm`} className="btn btn-primary">
            Done picking — Stage &amp; confirm →
          </Link>
          <form action={undoLastPick} className="ml-auto">
            <input type="hidden" name="tripId" value={trip.id} />
            <button className="btn btn-ghost text-sm" type="submit">
              Undo last pick
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
