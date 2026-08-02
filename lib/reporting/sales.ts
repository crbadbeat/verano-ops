import "server-only";
import { Prisma, type Division } from "@prisma/client";
import { prisma } from "@/lib/db";
import { resolveAttribution, normalizeCommissionId } from "@/lib/sales-attribution";
import { DIVISION_LABEL } from "@/lib/employees";
import { eachMonth, monthKey, monthLabel, type DateRange } from "./range";

// -----------------------------------------------------------------------------
// Sales dashboards — the Division → Region → Showroom → Rep drill-down over the
// NetSuite order book (historical + operational, both counted for sales). Every
// figure is derived at request time: no stored roll-ups. Attribution maps are
// built once per query from the Location/Employee tables and applied with the
// pure engine in lib/sales-attribution.ts.
//
// The dimension a sale rolls up to is NOT a column on Order (region comes via
// Location.regionId, rep via a commission-code → Employee lookup), so we fetch
// the minimal order rows for the window + drill scope and bucket them in memory
// — the same derive-don't-store shape as the exec cockpit.
// -----------------------------------------------------------------------------

/** The four drill tiers, outermost first. */
export type SalesTier = "division" | "region" | "showroom" | "rep";

/** Synthetic bucket keys for rows that don't resolve to a real dimension row. */
export const NO_REGION = "__none__";
export const UNMAPPED_SHOWROOM = "__unmapped__";
export const NO_REP = "__norep__";

export interface SalesDrill {
  division: Division | null;
  regionId: string | null;
  showroomId: string | null;
  repId: string | null;
}

export interface SalesRow {
  key: string; // the param value that drills into this row
  name: string;
  salesCents: number;
  orderCount: number;
  drillable: boolean; // false at the rep leaf (nothing deeper)
}

export interface Crumb {
  label: string;
  drill: SalesDrill; // the drill state this crumb links back to
}

export interface TopProduct {
  key: string;
  name: string;
  units: number;
}

export interface SalesRollup {
  childTier: SalesTier; // the tier of `rows` (the level BELOW the current scope)
  isLeaf: boolean; // current scope is a rep — no children, just its numbers
  rows: SalesRow[];
  totals: { salesCents: number; orderCount: number; avgCents: number };
  trend: { label: string; value: number }[]; // monthly, in dollars
  topProducts: TopProduct[];
  crumbs: Crumb[];
}

const EMPTY_DRILL: SalesDrill = { division: null, regionId: null, showroomId: null, repId: null };

/** The tier whose rows sit directly below the given drill scope. */
export function childTierOf(drill: SalesDrill): SalesTier {
  if (drill.showroomId) return "rep";
  if (drill.regionId) return "showroom";
  if (drill.division) return "region";
  return "division";
}

interface LoadedMaps {
  /** sales-center segment id → { showroom Location id, its region id }. */
  locationBySalesCenter: Map<number, { id: string; regionId: string | null }>;
  /** WMS employee code → employee id (for the rep tier). */
  employeeByCode: Map<string, string>;
  /** showroom Location id → display name. */
  showroomName: Map<string, string>;
  /** region id → name. */
  regionName: Map<string, string>;
  /** employee id → display name. */
  employeeName: Map<string, string>;
  /** every sales-center id that maps to a showroom WITH a region. */
  centerIdsWithRegion: number[];
  /** every sales-center id that maps to a known showroom. */
  allMappedCenterIds: number[];
  /** sales-center ids per region id. */
  centerIdsByRegion: Map<string, number[]>;
  /** the sales-center id for a showroom Location id. */
  centerIdByShowroom: Map<string, number>;
}

async function loadMaps(): Promise<LoadedMaps> {
  const [locations, regions, employees] = await Promise.all([
    prisma.location.findMany({
      where: { netsuiteSalesCenterId: { not: null } },
      select: { id: true, name: true, regionId: true, netsuiteSalesCenterId: true },
    }),
    prisma.region.findMany({ select: { id: true, name: true } }),
    prisma.employee.findMany({
      where: { code: { not: null } },
      select: { id: true, code: true, name: true },
    }),
  ]);

  const locationBySalesCenter = new Map<number, { id: string; regionId: string | null }>();
  const showroomName = new Map<string, string>();
  const centerIdsWithRegion: number[] = [];
  const allMappedCenterIds: number[] = [];
  const centerIdsByRegion = new Map<string, number[]>();
  const centerIdByShowroom = new Map<string, number>();
  for (const loc of locations) {
    const sc = loc.netsuiteSalesCenterId!;
    locationBySalesCenter.set(sc, { id: loc.id, regionId: loc.regionId });
    showroomName.set(loc.id, loc.name);
    centerIdByShowroom.set(loc.id, sc);
    allMappedCenterIds.push(sc);
    if (loc.regionId) {
      centerIdsWithRegion.push(sc);
      const list = centerIdsByRegion.get(loc.regionId) ?? [];
      list.push(sc);
      centerIdsByRegion.set(loc.regionId, list);
    }
  }

  const employeeByCode = new Map<string, string>();
  const employeeName = new Map<string, string>();
  for (const emp of employees) {
    const code = normalizeCommissionId(emp.code);
    if (code) employeeByCode.set(code, emp.id);
    employeeName.set(emp.id, emp.name);
  }

  return {
    locationBySalesCenter,
    employeeByCode,
    showroomName,
    regionName: new Map(regions.map((r) => [r.id, r.name])),
    employeeName,
    centerIdsWithRegion,
    allMappedCenterIds,
    centerIdsByRegion,
    centerIdByShowroom,
  };
}

/**
 * The order `where` for a drill scope + window. Division and the sales-center
 * constraint (region/showroom) are expressible in SQL; the rep constraint is a
 * derived commission-code lookup and is applied in memory by the caller.
 */
function orderWhere(range: DateRange, drill: SalesDrill, maps: LoadedMaps): Prisma.OrderWhereInput {
  const where: Prisma.OrderWhereInput = {
    purchasedAt: { gte: range.from, lt: range.toExclusive },
  };
  if (drill.division) where.division = drill.division;

  // The deepest sales-center constraint wins (showroom is narrower than region).
  if (drill.showroomId) {
    if (drill.showroomId === UNMAPPED_SHOWROOM) {
      where.OR = [{ salesCenterId: null }, { salesCenterId: { notIn: maps.allMappedCenterIds } }];
    } else {
      const sc = maps.centerIdByShowroom.get(drill.showroomId);
      where.salesCenterId = sc ?? -1; // -1 matches nothing if the showroom is unknown
    }
  } else if (drill.regionId) {
    if (drill.regionId === NO_REGION) {
      where.OR = [
        { salesCenterId: null },
        { salesCenterId: { notIn: maps.centerIdsWithRegion } },
      ];
    } else {
      where.salesCenterId = { in: maps.centerIdsByRegion.get(drill.regionId) ?? [-1] };
    }
  }
  return where;
}

interface ScopedOrder {
  division: Division | null;
  salesCenterId: number | null;
  totalCents: number | null;
  purchasedAt: Date | null;
  salesRep1Id: string | null;
  gtlId: string | null;
  regionalId: string | null;
  vpId: string | null;
}

/** The (key, name) a scoped order lands in for the given child tier. */
function bucketOf(order: ScopedOrder, tier: SalesTier, maps: LoadedMaps): { key: string; name: string } {
  const attr = resolveAttribution(order, maps);
  switch (tier) {
    case "division":
      return order.division
        ? { key: order.division, name: DIVISION_LABEL[order.division] }
        : { key: NO_REGION, name: "(no division)" };
    case "region":
      return attr.regionId
        ? { key: attr.regionId, name: maps.regionName.get(attr.regionId) ?? "(unknown region)" }
        : { key: NO_REGION, name: "(no region)" };
    case "showroom":
      return attr.showroomId
        ? { key: attr.showroomId, name: maps.showroomName.get(attr.showroomId) ?? "(unknown showroom)" }
        : { key: UNMAPPED_SHOWROOM, name: "(unmapped showroom)" };
    case "rep":
      return attr.repEmployeeId
        ? { key: attr.repEmployeeId, name: maps.employeeName.get(attr.repEmployeeId) ?? "(unknown rep)" }
        : { key: NO_REP, name: "(no rep)" };
  }
}

export async function getSalesRollup(
  range: DateRange,
  drill: SalesDrill
): Promise<SalesRollup> {
  const maps = await loadMaps();
  const childTier = childTierOf(drill);
  const isLeaf = drill.repId != null;
  const where = orderWhere(range, drill, maps);

  const [ordersRaw, productGroups] = await Promise.all([
    prisma.order.findMany({
      where,
      select: {
        division: true,
        salesCenterId: true,
        totalCents: true,
        purchasedAt: true,
        salesRep1Id: true,
        gtlId: true,
        regionalId: true,
        vpId: true,
      },
    }),
    prisma.orderLine.groupBy({
      by: ["productId"],
      where: { order: where },
      _sum: { qty: true },
      orderBy: { _sum: { qty: "desc" } },
      take: 12,
    }),
  ]);

  // Rep is a derived dimension, so filter the fetched rows in memory when the
  // scope is pinned to one rep ("(no rep)" = orders with no resolvable rep).
  const orders = drill.repId
    ? ordersRaw.filter((o) => {
        const repId = resolveAttribution(o, maps).repEmployeeId;
        return drill.repId === NO_REP ? repId == null : repId === drill.repId;
      })
    : ordersRaw;

  // Roll up to the child tier + accumulate totals and the monthly trend.
  const buckets = new Map<string, SalesRow>();
  const byMonth = new Map<string, number>();
  let totalCents = 0;
  for (const o of orders) {
    const cents = o.totalCents ?? 0;
    totalCents += cents;
    if (o.purchasedAt) {
      const mk = monthKey(o.purchasedAt);
      byMonth.set(mk, (byMonth.get(mk) ?? 0) + cents);
    }
    if (!isLeaf) {
      const { key, name } = bucketOf(o, childTier, maps);
      const row = buckets.get(key);
      if (row) {
        row.salesCents += cents;
        row.orderCount += 1;
      } else {
        buckets.set(key, {
          key,
          name,
          salesCents: cents,
          orderCount: 1,
          drillable: childTier !== "rep",
        });
      }
    }
  }

  const rows = [...buckets.values()].sort((a, b) => b.salesCents - a.salesCents);
  const months = eachMonth(range);
  const trend = months.map((mk) => ({
    label: monthLabel(mk),
    value: Math.round((byMonth.get(mk) ?? 0) / 100),
  }));

  const topProducts = await resolveTopProducts(productGroups);

  return {
    childTier,
    isLeaf,
    rows,
    totals: {
      salesCents: totalCents,
      orderCount: orders.length,
      avgCents: orders.length ? Math.round(totalCents / orders.length) : 0,
    },
    trend,
    topProducts,
    crumbs: buildCrumbs(drill, maps),
  };
}

async function resolveTopProducts(
  groups: { productId: string | null; _sum: { qty: number | null } }[]
): Promise<TopProduct[]> {
  const ids = groups.map((g) => g.productId).filter((id): id is string => id != null);
  const products = ids.length
    ? await prisma.product.findMany({
        where: { id: { in: ids } },
        select: { id: true, sku: true, displayName: true, name: true },
      })
    : [];
  const byId = new Map(products.map((p) => [p.id, p]));
  return groups.map((g) => {
    if (g.productId == null) {
      return { key: "__unmatched__", name: "(unmatched items)", units: g._sum.qty ?? 0 };
    }
    const p = byId.get(g.productId);
    return {
      key: g.productId,
      name: p ? p.displayName || p.name || p.sku : "(unknown product)",
      units: g._sum.qty ?? 0,
    };
  });
}

/** The breadcrumb trail from "All sales" down to the current drill scope. */
function buildCrumbs(drill: SalesDrill, maps: LoadedMaps): Crumb[] {
  const crumbs: Crumb[] = [{ label: "All sales", drill: EMPTY_DRILL }];
  if (drill.division) {
    crumbs.push({
      label: DIVISION_LABEL[drill.division],
      drill: { ...EMPTY_DRILL, division: drill.division },
    });
  }
  if (drill.regionId) {
    crumbs.push({
      label: drill.regionId === NO_REGION ? "(no region)" : maps.regionName.get(drill.regionId) ?? "Region",
      drill: { ...EMPTY_DRILL, division: drill.division, regionId: drill.regionId },
    });
  }
  if (drill.showroomId) {
    crumbs.push({
      label:
        drill.showroomId === UNMAPPED_SHOWROOM
          ? "(unmapped showroom)"
          : maps.showroomName.get(drill.showroomId) ?? "Showroom",
      drill: {
        ...EMPTY_DRILL,
        division: drill.division,
        regionId: drill.regionId,
        showroomId: drill.showroomId,
      },
    });
  }
  if (drill.repId) {
    crumbs.push({
      label: drill.repId === NO_REP ? "(no rep)" : maps.employeeName.get(drill.repId) ?? "Rep",
      drill: { ...drill },
    });
  }
  return crumbs;
}
