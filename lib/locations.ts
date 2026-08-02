import "server-only";
import QRCode from "qrcode";
import { prisma } from "@/lib/db";
import { normalizeLocationCode as normalize } from "./location-code";

// Warehouse-level stock for ONE warehouse (Ocoee) lives at locationId = null —
// the legacy convention every seed row was written under. That warehouse is
// flagged `isDefaultWarehouse` in the database rather than matched on its code:
// the real code is "4-OCOEE-WAREHOUSE-FL-PGS" (it mirrors NetSuite), so a code
// comparison silently failed and would have posted Ocoee counts into a second,
// empty slot. Every other site holds warehouse-level stock at its own id.
export async function defaultWarehouse() {
  return prisma.location.findFirst({
    where: { type: "WAREHOUSE", isDefaultWarehouse: true },
  });
}

/**
 * The locationId that means "warehouse level" for a given warehouse: null for
 * the default one, its own id for everywhere else. Getting this wrong posts one
 * site's stock into another's.
 */
export function warehouseLevelLocationId(warehouse: {
  id: string;
  isDefaultWarehouse: boolean;
}): string | null {
  return warehouse.isDefaultWarehouse ? null : warehouse.id;
}

// The virtual location that holds stock which has departed one warehouse but
// hasn't been received at the next. Keeps inventory conserved across a transfer.
export const IN_TRANSIT_CODE = "IN-TRANSIT";

/** Get (or lazily create) the virtual IN-TRANSIT location. */
export async function ensureInTransit() {
  return prisma.location.upsert({
    where: { code: IN_TRANSIT_CODE },
    create: { code: IN_TRANSIT_CODE, name: "In transit", type: "WAREHOUSE" },
    update: {},
  });
}

// The 17 staging lanes goods are picked into before they ship: Receiving,
// Returns, and 1..15. They are Location rows (flagged isStagingLane) under the
// default warehouse, so they can carry a QR label and hold per-lane inventory.
const STAGING_LANE_DEFS: { code: string; name: string }[] = [
  ...Array.from({ length: 15 }, (_, i) => ({
    code: `LANE-${String(i + 1).padStart(2, "0")}`,
    name: `Lane ${i + 1}`,
  })),
  { code: "LANE-RECEIVING", name: "Receiving" },
  { code: "LANE-RETURNS", name: "Returns" },
];

/**
 * Ensure the staging lanes exist and return them. Idempotent — only the missing
 * ones are created, so re-running is zero writes (the location-import perf rule).
 * Called when the lane-assignment UI loads.
 */
export async function ensureStagingLanes() {
  const ocoee = await defaultWarehouse();
  if (!ocoee) throw new Error("No default warehouse to attach staging lanes to.");

  const existing = await prisma.location.findMany({
    where: { code: { in: STAGING_LANE_DEFS.map((l) => l.code) } },
    select: { code: true },
  });
  const have = new Set(existing.map((e) => e.code));
  const missing = STAGING_LANE_DEFS.filter((l) => !have.has(l.code));
  if (missing.length) {
    await prisma.location.createMany({
      data: missing.map((l) => ({
        code: l.code,
        name: l.name,
        type: "BIN" as const,
        isStagingLane: true,
        parentId: ocoee.id,
      })),
      skipDuplicates: true,
    });
  }
  return listStagingLanes();
}

/** The staging lanes, numbered lanes first then Receiving / Returns. */
export async function listStagingLanes() {
  return prisma.location.findMany({
    where: { isStagingLane: true },
    orderBy: { code: "asc" },
  });
}

// Code parsing/normalising lives in lib/location-code.ts so it stays pure and
// testable; re-exported here because callers think of it as location behaviour.
export {
  normalizeLocationCode,
  parseLocationCode,
  compareAisles,
  compareBins,
} from "./location-code";

export async function listWarehouses() {
  return prisma.location.findMany({
    where: { type: "WAREHOUSE" },
    orderBy: { code: "asc" },
  });
}

export async function listBins(warehouseId: string) {
  return prisma.location.findMany({
    where: { type: "BIN", parentId: warehouseId },
    orderBy: { code: "asc" },
  });
}

export async function findLocationByCode(code: string) {
  return prisma.location.findUnique({
    where: { code: normalize(code) },
  });
}

/**
 * The value a location QR encodes: an absolute deep-link back into the count
 * home with the location preselected. Scanned by the in-app Scanner (which reads
 * the `loc` param) or by a phone camera (which opens the app at that location).
 */
export function locationQrUrl(code: string, origin: string): string {
  return `${origin}/count?loc=${encodeURIComponent(code)}`;
}

/** Rendered SVG QR (string) for a location's deep-link — for printable labels. */
export async function locationQrSvg(code: string, origin: string): Promise<string> {
  return QRCode.toString(locationQrUrl(code, origin), {
    type: "svg",
    margin: 1,
    errorCorrectionLevel: "M",
  });
}

/**
 * Rendered SVG QR whose payload is the raw SKU — the code a Base/Glass carries so
 * a picker's scan resolves straight to the product. Printed on /inventory/labels.
 */
export async function skuQrSvg(sku: string): Promise<string> {
  return QRCode.toString(sku, {
    type: "svg",
    margin: 1,
    errorCorrectionLevel: "M",
  });
}
