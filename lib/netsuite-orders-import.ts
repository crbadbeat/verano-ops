import "server-only";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import {
  runSuiteQL,
  fetchNetsuiteOrders,
  fetchCustomerDepositInfo,
  fetchItemNames,
  netsuiteConfig,
  NetsuiteNotConfiguredError,
  type NetsuiteConfig,
  type NetsuiteOrderRaw,
} from "@/lib/netsuite";
import { mapNetsuiteOrder, parseShipAddress, type NetsuiteOrder } from "@/lib/netsuite-orders";

// -----------------------------------------------------------------------------
// DB importer for the NetSuite order pull. Takes the raw SuiteQL rows, maps them
// (lib/netsuite-orders.ts), resolves products + customers + main-warehouse cost,
// and upserts orders into the review queue. Idempotent on netsuiteTransactionId
// (order) and netsuiteLineId (line). See the netsuite-orders-sync memo.
//
// No-clobber rule: an APPROVED order is only touched when NetSuite actually
// changed (lastmodifieddate advanced) — then it is re-derived from NetSuite (the
// corrected source) and sent back to PENDING_REVIEW. A routine no-change re-sync
// never overwrites a reviewed order's edits.
// -----------------------------------------------------------------------------

export interface OrderSyncSummary {
  fetched: number;
  created: number;
  updated: number;
  reflagged: number; // approved orders re-opened because NetSuite changed
  skipped: number; // approved + unchanged
  unmatchedLines: number;
  at: string;
}

/** The incremental watermark: the newest already-synced order's lastmodifieddate
 *  minus a 2-day buffer, as YYYY-MM-DD. Null (full open-set pull) on first run. */
export async function netsuiteOrderWatermark(): Promise<string | null> {
  const agg = await prisma.order.aggregate({
    where: { source: "NETSUITE", netsuiteLastModifiedAt: { not: null } },
    _max: { netsuiteLastModifiedAt: true },
  });
  const latest = agg._max.netsuiteLastModifiedAt;
  if (!latest) return null;
  return new Date(latest.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** Fetch + import in one call, shared by the cron route and the "Sync now" button.
 *  `sinceOverride` (YYYY-MM-DD) bypasses the watermark. */
export async function syncNetsuiteOrders(
  opts: { sinceOverride?: string | null; config?: NetsuiteConfig | null } = {}
): Promise<OrderSyncSummary & { since: string | null }> {
  const config = opts.config ?? netsuiteConfig();
  if (!config) throw new NetsuiteNotConfiguredError();
  const sinceDate =
    opts.sinceOverride && /^\d{4}-\d{2}-\d{2}$/.test(opts.sinceOverride)
      ? opts.sinceOverride
      : await netsuiteOrderWatermark();
  const raws = await fetchNetsuiteOrders({ sinceDate }, config);
  const summary = await importNetsuiteOrders(raws, config);
  return { ...summary, since: sinceDate };
}

function str(v: unknown): string {
  return v == null ? "" : String(v).trim();
}

/** Parse a NetSuite M/D/YYYY date to a Date, or null. */
function parseNsDate(v: string | null): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Resolve NetSuite item internal ids to WMS product ids. Primary: match
 * Product.netsuiteNumber. Secondary (best-effort): fetch the NetSuite item name
 * for still-unmatched ids and match it to Product.sku — this catches configured
 * bases whose smart-SKU equals the NetSuite item name.
 */
async function resolveProducts(
  itemIds: string[],
  config: NetsuiteConfig | null
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const ids = [...new Set(itemIds.filter((s) => s !== ""))];
  if (ids.length === 0) return map;

  const prods = await prisma.product.findMany({
    where: { netsuiteNumber: { in: ids } },
    select: { id: true, netsuiteNumber: true },
  });
  for (const p of prods) if (p.netsuiteNumber) map.set(p.netsuiteNumber, p.id);

  const unresolved = ids.filter((id) => !map.has(id) && /^\d+$/.test(id));
  if (unresolved.length && config) {
    try {
      const nameById = new Map<string, string>();
      const CH = 500;
      for (let i = 0; i < unresolved.length; i += CH) {
        const rows = await runSuiteQL(
          `SELECT id, itemid, displayname FROM item WHERE id IN (${unresolved.slice(i, i + CH).join(",")})`,
          config,
          "order item names"
        );
        for (const r of rows) {
          const id = str(r.id);
          const nm = str(r.itemid) || str(r.displayname);
          if (id && nm) nameById.set(id, nm);
        }
      }
      const names = [...new Set([...nameById.values()])];
      if (names.length) {
        const bySku = await prisma.product.findMany({
          where: { sku: { in: names } },
          select: { id: true, sku: true },
        });
        const skuToId = new Map(bySku.map((p) => [p.sku, p.id]));
        for (const [id, nm] of nameById) {
          const pid = skuToId.get(nm);
          if (pid) map.set(id, pid);
        }
      }
    } catch {
      // Secondary matching is best-effort; unmatched lines just go to review.
    }
  }
  return map;
}

/** Fetch customer name/email/phone for the given entity ids. */
async function fetchCustomers(
  entityIds: string[],
  config: NetsuiteConfig | null
): Promise<Map<string, Record<string, unknown>>> {
  const map = new Map<string, Record<string, unknown>>();
  const ids = [...new Set(entityIds.filter((s) => /^\d+$/.test(s)))];
  if (ids.length === 0 || !config) return map;
  const CH = 500;
  for (let i = 0; i < ids.length; i += CH) {
    const rows = await runSuiteQL(
      `SELECT id, firstname, lastname, entityid, email, phone FROM customer WHERE id IN (${ids.slice(i, i + CH).join(",")})`,
      config,
      "order customers"
    );
    for (const r of rows) map.set(str(r.id), r);
  }
  return map;
}

/** Unit COGS in cents for each product at the main warehouse (fallback: the
 *  product's account-wide standard cost). Shared by the order import (est COGS)
 *  and dispatch sign-off (true COGS snapshot). */
export async function mainWarehouseUnitCosts(productIds: string[]): Promise<Map<string, number>> {
  const cost = new Map<string, number>();
  const ids = [...new Set(productIds)];
  if (ids.length === 0) return cost;

  const mainWh = await prisma.location.findFirst({
    where: { isDefaultWarehouse: true },
    select: { id: true },
  });

  const [plc, prods] = await Promise.all([
    mainWh
      ? prisma.productLocationCost.findMany({
          where: { locationId: mainWh.id, productId: { in: ids } },
          select: { productId: true, averageCostCents: true },
        })
      : Promise.resolve([]),
    prisma.product.findMany({
      where: { id: { in: ids } },
      select: { id: true, standardCostCents: true },
    }),
  ]);
  for (const p of prods) if (p.standardCostCents != null) cost.set(p.id, p.standardCostCents);
  for (const r of plc) if (r.averageCostCents != null) cost.set(r.productId, r.averageCostCents); // warehouse wins
  return cost;
}

/**
 * Import a batch of raw NetSuite orders into the WMS review queue.
 */
export async function importNetsuiteOrders(
  raws: NetsuiteOrderRaw[],
  config: NetsuiteConfig | null = netsuiteConfig()
): Promise<OrderSyncSummary> {
  const now = new Date();
  const orders: NetsuiteOrder[] = [];
  for (const r of raws) {
    const o = mapNetsuiteOrder(r.header, r.lines);
    if (o) orders.push(o);
  }

  // Resolve products, customers and costs once for the whole batch.
  const allItemIds = orders.flatMap((o) => o.itemLines.map((l) => l.itemId));
  const productByItem = await resolveProducts(allItemIds, config);
  const costByProduct = await mainWarehouseUnitCosts([...new Set([...productByItem.values()])]);
  // Item display names, stored as each line's rawLabel so unmatched lines read as
  // the NetSuite item name (e.g. "GX10 Assembly C Drawer & Frig Base") not a blank.
  const itemNameById = await fetchItemNames(allItemIds, config);
  const entityIds = orders.map((o) => o.entityId ?? "").filter(Boolean);
  const customerById = await fetchCustomers(entityIds, config);
  // Deposit context: the SO's own rollup field is authoritative when set, but for
  // orders whose deposit sits unapplied on the customer (custbody = 0) we fall
  // back to the customer's unapplied deposit balance — attributable when they
  // have a single open order.
  const { balanceCentsByEntity, openOrderCountByEntity } = await fetchCustomerDepositInfo(entityIds, config);

  // Existing orders (for the create/update/skip decision).
  const txIds = orders.map((o) => o.netsuiteTransactionId);
  const existing = txIds.length
    ? await prisma.order.findMany({
        where: { netsuiteTransactionId: { in: txIds } },
        select: {
          id: true,
          netsuiteTransactionId: true,
          netsuiteReviewStatus: true,
          netsuiteLastModifiedAt: true,
        },
      })
    : [];
  const exByTx = new Map(existing.map((e) => [e.netsuiteTransactionId!, e]));

  const summary: OrderSyncSummary = {
    fetched: raws.length,
    created: 0,
    updated: 0,
    reflagged: 0,
    skipped: 0,
    unmatchedLines: 0,
    at: now.toISOString(),
  };

  // Build the header + line data for one order (pure, no DB).
  const build = (o: NetsuiteOrder) => {
    const cust = o.entityId ? customerById.get(o.entityId) : undefined;
    const addr = parseShipAddress(o.shipAddressText);
    const billAddr = parseShipAddress(o.billAddressText);
    let unmatched = 0;
    const lineData = o.itemLines.map((l) => {
      const productId = productByItem.get(l.itemId) ?? null;
      const unit = productId ? costByProduct.get(productId) ?? null : null;
      if (!productId) unmatched++;
      return {
        origin: "MANUAL" as const, // ownership is tracked by netsuiteLineId, not origin
        productId,
        rawLabel: itemNameById.get(l.itemId) ?? null,
        qty: Math.max(1, Math.round(l.qty)),
        note: l.memo,
        netsuiteLineId: l.netsuiteLineId,
        estCostCents: unit,
      };
    });
    const estCogsCents = lineData.reduce((s, l) => s + (l.estCostCents != null ? l.estCostCents * l.qty : 0), 0);

    // Deposit received: the SO's own rollup (custbody_total_deposit_paid) wins
    // when > 0. Otherwise fall back to the customer's unapplied deposit balance,
    // attributable only when they have ONE open order. With multiple open orders
    // we can't tie the loose deposit to this order → leave depositReceivedCents
    // null (fails the gate open) and expose it as "unverified" for a human.
    const custbodyDep = o.depositReceivedCents;
    const openCount = o.entityId ? openOrderCountByEntity.get(o.entityId) ?? 1 : 1;
    const custBalance = o.entityId ? balanceCentsByEntity.get(o.entityId) ?? 0 : 0;
    let depositReceivedCents: number | null;
    let depositUnverifiedCents: number | null = null;
    if (custbodyDep && custbodyDep > 0) {
      depositReceivedCents = custbodyDep;
    } else if (openCount <= 1) {
      depositReceivedCents = o.entityId ? custBalance : custbodyDep ?? 0;
    } else {
      depositReceivedCents = null; // ambiguous — don't gate
      depositUnverifiedCents = custBalance;
    }

    const header = {
      source: "NETSUITE" as const,
      division: o.division,
      netsuiteTransactionId: o.netsuiteTransactionId,
      netsuiteOrderNo: o.tranid,
      netsuiteEntityId: o.entityId,
      salesRep1Id: o.salesRep1Id,
      salesRep2Id: o.salesRep2Id,
      gtlId: o.gtlId,
      vpId: o.vpId,
      regionalId: o.regionalId,
      // The selling showroom (sales-center segment id) — resolves to a Location
      // (netsuiteSalesCenterId) → Region → Division for sales roll-ups.
      salesCenterId: /^\d+$/.test(o.salesCenterId ?? "") ? Number(o.salesCenterId) : null,
      purchasedAt: parseNsDate(o.trandate), // the SO's trandate = the real order date
      netsuiteLastModifiedAt: parseNsDate(o.lastModified),
      netsuiteSyncedAt: now,
      netsuiteReviewStatus: "PENDING_REVIEW" as const,
      customerFirst: cust ? str(cust.firstname) || null : null,
      customerLast: cust ? str(cust.lastname) || str(cust.entityid) || null : null,
      email: cust ? str(cust.email) || null : null,
      phone: cust ? str(cust.phone) || null : null,
      deliveryAddress: addr.address ?? addr.raw,
      deliveryCity: addr.city,
      deliveryState: addr.state,
      deliveryZip: addr.zip,
      billingAddress: billAddr.address ?? billAddr.raw,
      billingCity: billAddr.city,
      billingState: billAddr.state,
      billingZip: billAddr.zip,
      orderTotalCents: o.totalCents,
      totalCents: o.totalCents,
      salesTaxCents: o.salesTaxCents,
      freightCents: o.freightCents,
      // NetSuite assigns DISTINCT billing/shipping address ids even for identical
      // addresses, so an id mismatch is not a reliable fraud signal. NOT_REQUIRED;
      // proper billing-vs-shipping TEXT comparison is a follow-up.
      fraudCheckStatus: "NOT_REQUIRED" as const,
      estCogsCents,
      depositReceivedCents,
      depositUnverifiedCents,
      customerOpenOrderCount: openCount,
      depositSyncedAt: now,
    };
    return { header, lineData, unmatched };
  };

  // Partition: approved+unchanged are skipped (edits preserved); new orders are
  // batch-created (fast — one createMany each for orders/lines/events); pending
  // or drifted orders are updated in place (few in steady state).
  const skipIds: string[] = [];
  const creates: { o: NetsuiteOrder; built: ReturnType<typeof build> }[] = [];
  const updates: { exId: string; o: NetsuiteOrder; built: ReturnType<typeof build>; reflag: boolean }[] = [];

  for (const o of orders) {
    const ex = exByTx.get(o.netsuiteTransactionId);
    const nsMod = parseNsDate(o.lastModified);
    const drift =
      !ex?.netsuiteLastModifiedAt || (nsMod ? ex.netsuiteLastModifiedAt.getTime() !== nsMod.getTime() : false);
    if (ex && ex.netsuiteReviewStatus === "APPROVED" && !drift) {
      skipIds.push(ex.id);
      continue;
    }
    const built = build(o);
    summary.unmatchedLines += built.unmatched;
    if (!ex) creates.push({ o, built });
    else updates.push({ exId: ex.id, o, built, reflag: ex.netsuiteReviewStatus === "APPROVED" && drift });
  }

  const CHUNK = 300;
  const inChunks = async <T>(rows: T[], fn: (batch: T[]) => Promise<unknown>) => {
    for (let i = 0; i < rows.length; i += CHUNK) await fn(rows.slice(i, i + CHUNK));
  };

  // Skipped: just stamp the sync time.
  if (skipIds.length) {
    await inChunks(skipIds, (ids) =>
      prisma.order.updateMany({ where: { id: { in: ids } }, data: { netsuiteSyncedAt: now } })
    );
  }

  // Created: explicit ids so lines/events can be batched against them.
  if (creates.length) {
    const orderRows = creates.map(({ o, built }) => ({
      id: randomUUID(),
      ...built.header,
      orderNo: o.tranid,
      status: "DRAFT" as const,
    }));
    const lineRows = creates.flatMap(({ built }, i) => built.lineData.map((l) => ({ ...l, orderId: orderRows[i].id })));
    const eventRows = creates.map(({ o }, i) => ({
      orderId: orderRows[i].id,
      type: "NETSUITE_IMPORTED",
      summary: `Imported from NetSuite ${o.tranid}`,
    }));
    await inChunks(orderRows, (b) => prisma.order.createMany({ data: b }));
    await inChunks(lineRows, (b) => prisma.orderLine.createMany({ data: b }));
    await inChunks(eventRows, (b) => prisma.orderEvent.createMany({ data: b }));
    summary.created = creates.length;
  }

  // Updated: per order (re-derive sync-owned lines, keep any human-added ones).
  for (const { exId, o, built, reflag } of updates) {
    await prisma.$transaction([
      prisma.order.update({ where: { id: exId }, data: built.header }),
      prisma.orderLine.deleteMany({ where: { orderId: exId, netsuiteLineId: { not: null } } }),
      ...(built.lineData.length
        ? [prisma.orderLine.createMany({ data: built.lineData.map((l) => ({ ...l, orderId: exId })) })]
        : []),
      prisma.orderEvent.create({
        data: {
          orderId: exId,
          type: reflag ? "NETSUITE_CHANGED_AFTER_APPROVAL" : "NETSUITE_SYNCED",
          summary: reflag
            ? `NetSuite ${o.tranid} changed after approval — re-opened for review`
            : `Re-synced from NetSuite ${o.tranid}`,
        },
      }),
    ]);
    if (reflag) summary.reflagged++;
    else summary.updated++;
  }

  summary.skipped = skipIds.length;
  return summary;
}

export interface HistoricalImportSummary {
  fetched: number;
  created: number;
  skippedExisting: number;
  unmatchedLines: number;
}

/**
 * Lean, CREATE-ONLY importer for the historical/analytics backfill. Unlike the
 * operational sync it: (1) never touches an order that already exists (the live
 * order book is authoritative — we only ADD the closed history around it);
 * (2) marks orders `isHistorical: true` and leaves review/deposit machinery out
 * (billed sales don't belong in the review queue). It still resolves products,
 * costs, item names and customer names so product-level sales trends work.
 */
export async function importHistoricalOrders(
  raws: NetsuiteOrderRaw[],
  config: NetsuiteConfig | null = netsuiteConfig()
): Promise<HistoricalImportSummary> {
  const now = new Date();
  const mapped: NetsuiteOrder[] = [];
  for (const r of raws) {
    const o = mapNetsuiteOrder(r.header, r.lines);
    if (o) mapped.push(o);
  }

  // Create-only: drop any tx id we already hold (operational or already-backfilled).
  const txIds = mapped.map((o) => o.netsuiteTransactionId);
  const existing = txIds.length
    ? await prisma.order.findMany({
        where: { netsuiteTransactionId: { in: txIds } },
        select: { netsuiteTransactionId: true },
      })
    : [];
  const have = new Set(existing.map((e) => e.netsuiteTransactionId!));
  const orders = mapped.filter((o) => !have.has(o.netsuiteTransactionId));
  const skippedExisting = mapped.length - orders.length;
  if (orders.length === 0) {
    return { fetched: raws.length, created: 0, skippedExisting, unmatchedLines: 0 };
  }

  const allItemIds = orders.flatMap((o) => o.itemLines.map((l) => l.itemId));
  const productByItem = await resolveProducts(allItemIds, config);
  const costByProduct = await mainWarehouseUnitCosts([...new Set([...productByItem.values()])]);
  const itemNameById = await fetchItemNames(allItemIds, config);
  const customerById = await fetchCustomers(
    orders.map((o) => o.entityId ?? "").filter(Boolean),
    config
  );

  let unmatchedLines = 0;
  const orderRows: Record<string, unknown>[] = [];
  const lineRows: Record<string, unknown>[] = [];
  for (const o of orders) {
    const id = randomUUID();
    const cust = o.entityId ? customerById.get(o.entityId) : undefined;
    const addr = parseShipAddress(o.shipAddressText);
    const billAddr = parseShipAddress(o.billAddressText);
    let estCogsCents = 0;
    for (const l of o.itemLines) {
      const productId = productByItem.get(l.itemId) ?? null;
      const unit = productId ? costByProduct.get(productId) ?? null : null;
      const qty = Math.max(1, Math.round(l.qty));
      if (!productId) unmatchedLines++;
      if (unit != null) estCogsCents += unit * qty;
      lineRows.push({
        orderId: id,
        origin: "MANUAL",
        productId,
        rawLabel: itemNameById.get(l.itemId) ?? null,
        qty,
        note: l.memo,
        netsuiteLineId: l.netsuiteLineId,
        estCostCents: unit,
      });
    }
    orderRows.push({
      id,
      orderNo: o.tranid,
      status: "DRAFT",
      source: "NETSUITE",
      isHistorical: true, // analytics-only; hidden from operational views
      division: o.division,
      netsuiteTransactionId: o.netsuiteTransactionId,
      netsuiteOrderNo: o.tranid,
      netsuiteEntityId: o.entityId,
      salesRep1Id: o.salesRep1Id,
      salesRep2Id: o.salesRep2Id,
      gtlId: o.gtlId,
      vpId: o.vpId,
      regionalId: o.regionalId,
      salesCenterId: /^\d+$/.test(o.salesCenterId ?? "") ? Number(o.salesCenterId) : null,
      purchasedAt: parseNsDate(o.trandate),
      netsuiteLastModifiedAt: parseNsDate(o.lastModified),
      netsuiteSyncedAt: now,
      // No review status: historical billed orders never enter the review queue.
      customerFirst: cust ? str(cust.firstname) || null : null,
      customerLast: cust ? str(cust.lastname) || str(cust.entityid) || null : null,
      email: cust ? str(cust.email) || null : null,
      phone: cust ? str(cust.phone) || null : null,
      deliveryAddress: addr.address ?? addr.raw,
      deliveryCity: addr.city,
      deliveryState: addr.state,
      deliveryZip: addr.zip,
      billingAddress: billAddr.address ?? billAddr.raw,
      billingCity: billAddr.city,
      billingState: billAddr.state,
      billingZip: billAddr.zip,
      orderTotalCents: o.totalCents,
      totalCents: o.totalCents,
      salesTaxCents: o.salesTaxCents,
      freightCents: o.freightCents,
      fraudCheckStatus: "NOT_REQUIRED",
      estCogsCents,
    });
  }

  const CHUNK = 300;
  for (let i = 0; i < orderRows.length; i += CHUNK) {
    await prisma.order.createMany({ data: orderRows.slice(i, i + CHUNK) as never, skipDuplicates: true });
  }
  for (let i = 0; i < lineRows.length; i += CHUNK) {
    await prisma.orderLine.createMany({ data: lineRows.slice(i, i + CHUNK) as never, skipDuplicates: true });
  }

  return { fetched: raws.length, created: orders.length, skippedExisting, unmatchedLines };
}
