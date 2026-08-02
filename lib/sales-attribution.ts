import type { Division } from "@prisma/client";

// -----------------------------------------------------------------------------
// Sales attribution — resolve a NetSuite order to the Division → Region →
// Showroom → Rep hierarchy. Pure: the caller supplies lookup maps (built from the
// DB once per dashboard query), so this stays testable and the aggregation layer
// does the Prisma work.
// -----------------------------------------------------------------------------

/**
 * Normalize a NetSuite commission id to the WMS employee code. NetSuite writes
 * the D/I code hyphenated ("D-1703"); our Employee.code is "D1703". Strip
 * non-alphanumerics and upper-case so the two line up.
 */
export function normalizeCommissionId(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const c = raw.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  return c || null;
}

export interface AttributionMaps {
  /** sales-center segment id → { showroom Location id, its region id }. */
  locationBySalesCenter: Map<number, { id: string; regionId: string | null }>;
  /** WMS employee code → employee id. */
  employeeByCode: Map<string, string>;
}

export interface OrderAttribution {
  division: Division | null;
  showroomId: string | null;
  regionId: string | null;
  repEmployeeId: string | null;
  gtlEmployeeId: string | null;
  regionalEmployeeId: string | null;
  vpEmployeeId: string | null;
}

export interface AttributableOrder {
  division: Division | null;
  salesCenterId: number | null;
  salesRep1Id: string | null;
  gtlId: string | null;
  regionalId: string | null;
  vpId: string | null;
}

/** Resolve one order to its Division/Region/Showroom/Rep attribution. */
export function resolveAttribution(order: AttributableOrder, maps: AttributionMaps): OrderAttribution {
  const loc = order.salesCenterId != null ? maps.locationBySalesCenter.get(order.salesCenterId) : undefined;
  const emp = (id: string | null): string | null => {
    const code = normalizeCommissionId(id);
    return code ? maps.employeeByCode.get(code) ?? null : null;
  };
  return {
    division: order.division,
    showroomId: loc?.id ?? null,
    regionId: loc?.regionId ?? null,
    repEmployeeId: emp(order.salesRep1Id),
    gtlEmployeeId: emp(order.gtlId),
    regionalEmployeeId: emp(order.regionalId),
    vpEmployeeId: emp(order.vpId),
  };
}
