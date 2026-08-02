import "server-only";
import { prisma } from "./db";
import { summarizePick } from "./picking";
import { productDisplayName } from "./item-master";

// -----------------------------------------------------------------------------
// One trip, summarized for the downstream ops screens (Stage/Lane-confirm, QC,
// Driver sign-off). The Directed Pick screen keeps its own richer query because
// it also needs per-bin source locations; everything past picking only needs the
// staged-vs-needed picture plus the customer stops, so it shares this helper.
//
// Derived, never stored: `needed` is the trip's pickable order lines; `staged`
// is the net PICK ledger sitting in the trip's lane(s) — the same derivation the
// pick screen uses (see summarizePick).
// -----------------------------------------------------------------------------

export interface TripStop {
  orderId: string;
  orderNo: string;
  customer: string;
  itemCount: number; // pickable units on this order
}

export interface TripLineSummary {
  productId: string;
  sku: string;
  name: string;
  category: string | null;
  needed: number;
  staged: number; // raw net qty in the lane (may exceed needed if over-picked)
  remaining: number; // clamped at 0
}

export interface TripSummary {
  neededTotal: number;
  stagedTotal: number; // sum of staged, clamped per line to needed (for the "N/M" headline)
  shortCount: number;
  allStaged: boolean;
  lines: TripLineSummary[]; // sorted by SKU
  stops: TripStop[];
}

/** Staged-vs-needed rollup + customer stops for one trip. Null if the trip is gone. */
export async function summarizeTrip(tripId: string): Promise<TripSummary | null> {
  const trip = await prisma.deliveryTrip.findUnique({
    where: { id: tripId },
    select: {
      lanes: { select: { laneId: true } },
      orders: {
        select: {
          id: true,
          orderNo: true,
          customerFirst: true,
          customerLast: true,
          lines: {
            select: {
              qty: true,
              productId: true,
              product: {
                select: { id: true, sku: true, displayName: true, name: true, category: true, pickable: true },
              },
            },
          },
        },
      },
    },
  });
  if (!trip) return null;

  // Needed = pickable order lines aggregated by product; per-order item count.
  const neededByProduct = new Map<
    string,
    {
      product: { id: string; sku: string; displayName: string | null; name: string; category: string | null };
      needed: number;
    }
  >();
  const stops: TripStop[] = [];
  for (const o of trip.orders) {
    let itemCount = 0;
    for (const l of o.lines) {
      if (!l.productId || !l.product?.pickable) continue;
      itemCount += l.qty;
      const cur = neededByProduct.get(l.productId);
      if (cur) cur.needed += l.qty;
      else neededByProduct.set(l.productId, { product: l.product, needed: l.qty });
    }
    const customer =
      [o.customerFirst, o.customerLast].filter(Boolean).join(" ").trim() || o.orderNo;
    stops.push({ orderId: o.id, orderNo: o.orderNo, customer, itemCount });
  }

  const neededList = [...neededByProduct.values()];
  const laneIds = trip.lanes.map((l) => l.laneId);
  const stagedRows = laneIds.length
    ? await prisma.inventoryLedger.groupBy({
        by: ["productId"],
        where: { tripId, locationId: { in: laneIds } },
        _sum: { qtyDelta: true },
      })
    : [];
  const stagedByProduct = new Map(stagedRows.map((r) => [r.productId, r._sum.qtyDelta ?? 0]));

  const progress = summarizePick(
    neededList.map((n) => ({ productId: n.product.id, needed: n.needed })),
    stagedByProduct
  );
  const progByProduct = new Map(progress.lines.map((l) => [l.productId, l]));

  const lines: TripLineSummary[] = neededList
    .map((n) => {
      const p = progByProduct.get(n.product.id);
      return {
        productId: n.product.id,
        sku: n.product.sku,
        name: productDisplayName(n.product),
        category: n.product.category,
        needed: n.needed,
        staged: p?.staged ?? 0,
        remaining: p?.remaining ?? n.needed,
      };
    })
    .sort((a, b) => a.sku.localeCompare(b.sku));

  const neededTotal = lines.reduce((s, l) => s + l.needed, 0);
  const stagedTotal = lines.reduce((s, l) => s + Math.min(l.staged, l.needed), 0);

  return {
    neededTotal,
    stagedTotal,
    shortCount: progress.shortCount,
    allStaged: progress.allDone,
    lines,
    stops,
  };
}
