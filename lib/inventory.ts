import type { LedgerReason, StockCondition } from "@prisma/client";
import { prisma } from "@/lib/db";
import { defaultWarehouse } from "@/lib/locations";
import { burdenedCost } from "@/lib/overhead";

/** On-hand for every product = SUM(qtyDelta) grouped by product. */
export async function onHandByProduct(): Promise<Map<string, number>> {
  const grouped = await prisma.inventoryLedger.groupBy({
    by: ["productId"],
    _sum: { qtyDelta: true },
  });
  const map = new Map<string, number>();
  for (const g of grouped) map.set(g.productId, g._sum.qtyDelta ?? 0);
  return map;
}

/** On-hand for a single product (total across every location). */
export async function onHandForProduct(productId: string): Promise<number> {
  const agg = await prisma.inventoryLedger.aggregate({
    where: { productId },
    _sum: { qtyDelta: true },
  });
  return agg._sum.qtyDelta ?? 0;
}

// ---- location-aware on-hand ------------------------------------------------
// Convention: a ledger row's `locationId === null` means the default warehouse
// at "warehouse level" (this is where legacy seed rows and warehouse-level base
// counts live). A bin/appliance/glass slot is an explicit `locationId`.
//
// Show goods share bins with new stock, so a slot is (product, location,
// CONDITION). Leaving the condition out of a slot key silently merges show goods
// into new stock and makes every count variance wrong, so it is a REQUIRED
// argument rather than an optional one — a missing condition is a compile error,
// not a quiet miscount.

/** Stable key for a (product, location, condition) slot; null location = warehouse level. */
export function productLocationKey(
  productId: string,
  locationId: string | null,
  condition: StockCondition
): string {
  return `${productId}::${locationId ?? "_"}::${condition}`;
}

/** On-hand for one exact (product, location, condition) slot. */
export async function onHandForProductAtLocation(
  productId: string,
  locationId: string | null,
  condition: StockCondition
): Promise<number> {
  const agg = await prisma.inventoryLedger.aggregate({
    where: { productId, locationId, condition },
    _sum: { qtyDelta: true },
  });
  return agg._sum.qtyDelta ?? 0;
}

/**
 * Derived on-hand grouped by (product, location, condition) — one query for a
 * whole count session. Look up with `productLocationKey(...)`.
 */
export async function onHandByProductLocation(
  productIds?: string[]
): Promise<Map<string, number>> {
  const grouped = await prisma.inventoryLedger.groupBy({
    by: ["productId", "locationId", "condition"],
    where:
      productIds && productIds.length ? { productId: { in: productIds } } : undefined,
    _sum: { qtyDelta: true },
  });
  const map = new Map<string, number>();
  for (const g of grouped) {
    map.set(
      productLocationKey(g.productId, g.locationId, g.condition),
      g._sum.qtyDelta ?? 0
    );
  }
  return map;
}

/**
 * On-hand split by condition for one product, across every location. Show goods
 * are real stock worth the same as new, so callers that want a single number
 * should add them; this is for showing the split.
 */
export async function onHandByConditionForProduct(
  productId: string
): Promise<Record<StockCondition, number>> {
  const grouped = await prisma.inventoryLedger.groupBy({
    by: ["condition"],
    where: { productId },
    _sum: { qtyDelta: true },
  });
  const out: Record<StockCondition, number> = { NEW: 0, SHOW_GOOD: 0 };
  for (const g of grouped) out[g.condition] = g._sum.qtyDelta ?? 0;
  return out;
}

/** Products that currently hold show-good stock, with how much. */
export async function showGoodOnHandByProduct(): Promise<Map<string, number>> {
  const grouped = await prisma.inventoryLedger.groupBy({
    by: ["productId"],
    where: { condition: "SHOW_GOOD" },
    _sum: { qtyDelta: true },
  });
  const map = new Map<string, number>();
  for (const g of grouped) {
    const qty = g._sum.qtyDelta ?? 0;
    if (qty !== 0) map.set(g.productId, qty);
  }
  return map;
}

export interface ProductWithOnHand {
  id: string;
  sku: string;
  name: string;
  category: string | null;
  uom: string;
  active: boolean;
  onHand: number;
}

export async function listProductsWithOnHand(
  search?: string
): Promise<ProductWithOnHand[]> {
  const products = await prisma.product.findMany({
    where: search
      ? {
          OR: [
            { sku: { contains: search, mode: "insensitive" } },
            { name: { contains: search, mode: "insensitive" } },
          ],
        }
      : undefined,
    orderBy: { sku: "asc" },
  });
  const onHand = await onHandByProduct();
  return products.map((p) => ({
    id: p.id,
    sku: p.sku,
    name: p.name,
    category: p.category,
    uom: p.uom,
    active: p.active,
    onHand: onHand.get(p.id) ?? 0,
  }));
}

// ---- per-warehouse rollup --------------------------------------------------
// A "warehouse stock view" needs on-hand rolled up to the warehouse a ledger row
// physically belongs to. A row's locationId maps to a warehouse by:
//   • null            → the default warehouse (the legacy Ocoee convention)
//   • a WAREHOUSE id  → that warehouse itself (its warehouse-level stock, plus
//                       AZ / showrooms / IN-TRANSIT, which hold theirs at own id)
//   • a BIN id        → its parent warehouse (parentId) — a bin, staging lane…
// Show goods sit in the same bins as new stock, so every slot keeps the
// (product, condition) split rather than collapsing to a single number.

export interface StockSplit {
  new: number;
  showGood: number;
}

/** new + show-good, i.e. the sellable+open-box total (both are real stock). */
export function splitTotal(s: StockSplit): number {
  return s.new + s.showGood;
}

function addToSplit(map: Map<string, StockSplit>, productId: string, condition: StockCondition, qty: number) {
  const cur = map.get(productId) ?? { new: 0, showGood: 0 };
  if (condition === "SHOW_GOOD") cur.showGood += qty;
  else cur.new += qty;
  map.set(productId, cur);
}

/** Build the locationId → owning-warehouse-id map from the location registry. */
async function warehouseOfLocation(): Promise<{
  whOf: Map<string, string>;
  defaultWarehouseId: string | null;
}> {
  const [locations, def] = await Promise.all([
    prisma.location.findMany({ select: { id: true, type: true, parentId: true } }),
    defaultWarehouse(),
  ]);
  const whOf = new Map<string, string>();
  for (const l of locations) {
    if (l.type === "WAREHOUSE") whOf.set(l.id, l.id);
    else if (l.parentId) whOf.set(l.id, l.parentId);
    // a bin with no parent can't be attributed to a warehouse — deliberately dropped
  }
  return { whOf, defaultWarehouseId: def?.id ?? null };
}

/**
 * On-hand rolled up to the warehouse level for EVERY (warehouse, product):
 * outer key = warehouse Location id, inner key = productId, value = NEW/SHOW_GOOD
 * split. One ledger groupBy + one locations read serve both the per-warehouse
 * stock page and the whole-network dashboard.
 */
export async function stockByWarehouse(): Promise<Map<string, Map<string, StockSplit>>> {
  const [grouped, { whOf, defaultWarehouseId }] = await Promise.all([
    prisma.inventoryLedger.groupBy({
      by: ["productId", "locationId", "condition"],
      _sum: { qtyDelta: true },
    }),
    warehouseOfLocation(),
  ]);

  const out = new Map<string, Map<string, StockSplit>>();
  for (const g of grouped) {
    const whId = g.locationId === null ? defaultWarehouseId : whOf.get(g.locationId) ?? null;
    if (!whId) continue; // orphaned row or no default warehouse configured
    let inner = out.get(whId);
    if (!inner) {
      inner = new Map<string, StockSplit>();
      out.set(whId, inner);
    }
    addToSplit(inner, g.productId, g.condition, g._sum.qtyDelta ?? 0);
  }
  return out;
}

/** The NEW/SHOW_GOOD split for one product at one warehouse (0/0 if none). */
export function stockAt(
  byWarehouse: Map<string, Map<string, StockSplit>>,
  warehouseId: string,
  productId: string
): StockSplit {
  return byWarehouse.get(warehouseId)?.get(productId) ?? { new: 0, showGood: 0 };
}

export interface ProductWarehouseStock {
  warehouseId: string;
  code: string;
  name: string;
  isDefaultWarehouse: boolean;
  split: StockSplit;
  /** Per-location detail within the warehouse (warehouse level + each bin). */
  slots: { locationId: string | null; label: string; condition: StockCondition; qty: number }[];
}

/**
 * The full location breakdown for ONE product, grouped by warehouse and then by
 * bin — for the item-detail "where it is" view. Warehouses with any nonzero slot
 * only; the default warehouse's null slot is labelled "warehouse level".
 */
export async function productStockByWarehouse(
  productId: string
): Promise<ProductWarehouseStock[]> {
  const [grouped, locations, def] = await Promise.all([
    prisma.inventoryLedger.groupBy({
      by: ["locationId", "condition"],
      where: { productId },
      _sum: { qtyDelta: true },
    }),
    prisma.location.findMany({
      select: { id: true, code: true, name: true, type: true, parentId: true, isDefaultWarehouse: true },
    }),
    defaultWarehouse(),
  ]);

  const locById = new Map(locations.map((l) => [l.id, l]));
  const warehouses = new Map<string, ProductWarehouseStock>();
  const wh = (id: string): ProductWarehouseStock => {
    const existing = warehouses.get(id);
    if (existing) return existing;
    const loc = locById.get(id);
    const created: ProductWarehouseStock = {
      warehouseId: id,
      code: loc?.code ?? "(unknown)",
      name: loc?.name ?? "(unknown warehouse)",
      isDefaultWarehouse: loc?.isDefaultWarehouse ?? false,
      split: { new: 0, showGood: 0 },
      slots: [],
    };
    warehouses.set(id, created);
    return created;
  };

  for (const g of grouped) {
    const qty = g._sum.qtyDelta ?? 0;
    if (qty === 0) continue;
    let whId: string | null;
    let label: string;
    if (g.locationId === null) {
      whId = def?.id ?? null;
      label = "Warehouse level";
    } else {
      const loc = locById.get(g.locationId);
      whId = loc ? (loc.type === "WAREHOUSE" ? loc.id : loc.parentId) : null;
      label = loc?.type === "WAREHOUSE" ? "Warehouse level" : loc?.code ?? "(unknown location)";
    }
    if (!whId) continue;
    const w = wh(whId);
    w.slots.push({ locationId: g.locationId, label, condition: g.condition, qty });
    if (g.condition === "SHOW_GOOD") w.split.showGood += qty;
    else w.split.new += qty;
  }

  return [...warehouses.values()]
    .sort((a, b) => {
      if (a.isDefaultWarehouse !== b.isDefaultWarehouse) return a.isDefaultWarehouse ? -1 : 1;
      return splitTotal(b.split) - splitTotal(a.split);
    })
    .map((w) => ({
      ...w,
      slots: w.slots.sort((s1, s2) => s2.qty - s1.qty),
    }));
}

// ---- per-warehouse cost ----------------------------------------------------

/**
 * NetSuite per-warehouse average cost (in cents) for one product, keyed by the
 * warehouse Location id. Empty when the item has no synced per-location cost yet
 * (e.g. its warehouse isn't linked to a NetSuite location, or the sync hasn't run).
 */
export async function locationCostsForProduct(
  productId: string
): Promise<Map<string, number>> {
  const rows = await prisma.productLocationCost.findMany({
    where: { productId },
    select: { locationId: true, averageCostCents: true },
  });
  return new Map(rows.map((r) => [r.locationId, r.averageCostCents]));
}

/**
 * NetSuite per-warehouse average cost (in cents) for EVERY product at one
 * warehouse, keyed by productId — for the per-warehouse stock list. Callers fall
 * back to Product.standardCostCents (the account-wide average) where a product
 * has no warehouse-specific cost.
 */
export async function costsForWarehouse(
  warehouseId: string
): Promise<Map<string, number>> {
  const rows = await prisma.productLocationCost.findMany({
    where: { locationId: warehouseId },
    select: { productId: true, averageCostCents: true },
  });
  return new Map(rows.map((r) => [r.productId, r.averageCostCents]));
}

export interface WarehouseValue {
  warehouseId: string;
  code: string;
  name: string;
  isDefaultWarehouse: boolean;
  units: number;
  valueCents: number;
}

/**
 * Inventory value per warehouse = on-hand × average cost, warehouse-specific cost
 * where synced (ProductLocationCost) else the account-wide average
 * (Product.standardCostCents). Matches the Stock page's per-warehouse figures so
 * a dashboard row and the warehouse it links to agree. Sorted by value desc.
 */
export async function valueByWarehouse(overheadBps: number): Promise<WarehouseValue[]> {
  const [byWarehouse, warehouses, plc, products] = await Promise.all([
    stockByWarehouse(),
    prisma.location.findMany({
      where: { type: "WAREHOUSE" },
      select: { id: true, code: true, name: true, isDefaultWarehouse: true, overheadExempt: true },
    }),
    prisma.productLocationCost.findMany({
      select: { productId: true, locationId: true, averageCostCents: true },
    }),
    prisma.product.findMany({ select: { id: true, standardCostCents: true } }),
  ]);
  const plcMap = new Map(plc.map((r) => [`${r.locationId}::${r.productId}`, r.averageCostCents]));
  const acct = new Map(products.map((p) => [p.id, p.standardCostCents]));

  const rows: WarehouseValue[] = warehouses.map((wh) => {
    const inner = byWarehouse.get(wh.id);
    let units = 0;
    let valueCents = 0;
    if (inner) {
      for (const [productId, split] of inner) {
        const qty = splitTotal(split);
        units += qty;
        const base = plcMap.get(`${wh.id}::${productId}`) ?? acct.get(productId);
        if (base != null) valueCents += qty * burdenedCost(base, overheadBps, wh.overheadExempt);
      }
    }
    return {
      warehouseId: wh.id,
      code: wh.code,
      name: wh.name,
      isDefaultWarehouse: wh.isDefaultWarehouse,
      units,
      valueCents,
    };
  });
  return rows.sort((a, b) => b.valueCents - a.valueCents);
}

// ---- dashboard rollups -----------------------------------------------------

/** Outbound ledger reasons — stock physically leaving (for "movers"). */
export const OUTBOUND_REASONS: LedgerReason[] = [
  "SHIPMENT",
  "CONSUME",
  "TRANSFER_OUT",
  "MOD_OUT",
];

export interface MoverRow {
  productId: string;
  unitsOut: number;
  moves: number;
}

/**
 * Top movers since `since`: units that physically left (outbound reasons) per
 * product, most first. Uses the [reason, createdAt] ledger index.
 */
export async function topMoversSince(since: Date, limit = 10): Promise<MoverRow[]> {
  const grouped = await prisma.inventoryLedger.groupBy({
    by: ["productId"],
    where: { reason: { in: OUTBOUND_REASONS }, createdAt: { gte: since } },
    _sum: { qtyDelta: true },
    _count: { _all: true },
  });
  return grouped
    .map((g) => ({
      productId: g.productId,
      unitsOut: -(g._sum.qtyDelta ?? 0), // outbound deltas are negative
      moves: g._count._all,
    }))
    .filter((m) => m.unitsOut > 0)
    .sort((a, b) => b.unitsOut - a.unitsOut)
    .slice(0, limit);
}

/** Most-recent ledger activity per product — the basis for an aging view. */
export async function lastMovementByProduct(): Promise<Map<string, Date>> {
  const grouped = await prisma.inventoryLedger.groupBy({
    by: ["productId"],
    _max: { createdAt: true },
  });
  const map = new Map<string, Date>();
  for (const g of grouped) if (g._max.createdAt) map.set(g.productId, g._max.createdAt);
  return map;
}
