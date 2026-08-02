import "server-only";
import { prisma } from "@/lib/db";
import { IN_TRANSIT_CODE } from "@/lib/locations";

// -----------------------------------------------------------------------------
// Operations Manager network cockpit: on-hand rolled up per warehouse, the
// transfer / in-transit pipeline, and transfer cycle time. Current-state (a
// balance snapshot), company-wide. Bins roll up to their parent warehouse; the
// virtual IN-TRANSIT location is reported as in-transit, not as a site.
// -----------------------------------------------------------------------------

export interface WarehouseUnits {
  id: string;
  name: string;
  units: number;
  isDefault: boolean;
}

export interface DestUnits {
  id: string;
  name: string;
  units: number;
}

export interface NetworkMetrics {
  perWarehouse: WarehouseUnits[];
  networkUnits: number;
  inTransitUnits: number;
  inTransitCount: number;
  inTransitByDest: DestUnits[];
  transfersStaged: number;
  transferCycleDays: number | null;
  pipeline: { status: string; count: number }[];
}

const TRANSFER_ORDER = ["STAGED", "IN_TRANSIT", "RECEIVED", "CANCELLED"] as const;

export async function getNetworkMetrics(): Promise<NetworkMetrics> {
  const [locations, ledgerByLoc, inTransit, pipelineGroups, received, stagedCount] =
    await Promise.all([
      prisma.location.findMany({
        select: { id: true, name: true, code: true, type: true, parentId: true, isDefaultWarehouse: true },
      }),
      prisma.inventoryLedger.groupBy({ by: ["locationId"], _sum: { qtyDelta: true } }),
      prisma.transfer.findMany({
        where: { status: "IN_TRANSIT" },
        select: { destWarehouseId: true, lines: { select: { qty: true } } },
      }),
      prisma.transfer.groupBy({ by: ["status"], _count: { _all: true } }),
      prisma.transfer.findMany({
        where: { status: "RECEIVED", departedAt: { not: null }, receivedAt: { not: null } },
        select: { departedAt: true, receivedAt: true },
      }),
      prisma.transfer.count({ where: { status: "STAGED" } }),
    ]);

  const byId = new Map(locations.map((l) => [l.id, l]));
  const warehouses = locations.filter((l) => l.type === "WAREHOUSE");
  const defaultWh = warehouses.find((w) => w.isDefaultWarehouse);

  // Route a ledger row's location to the warehouse that holds it.
  const warehouseFor = (locationId: string | null): string | null => {
    if (locationId == null) return defaultWh?.id ?? null;
    const loc = byId.get(locationId);
    if (!loc) return null;
    if (loc.type === "WAREHOUSE") return loc.id; // includes the virtual IN-TRANSIT
    return loc.parentId ?? null; // a bin rolls up to its warehouse
  };

  const perWh = new Map<string, number>();
  let networkUnits = 0;
  for (const group of ledgerByLoc) {
    const units = group._sum.qtyDelta ?? 0;
    networkUnits += units;
    const whId = warehouseFor(group.locationId);
    if (whId) perWh.set(whId, (perWh.get(whId) ?? 0) + units);
  }

  const perWarehouse: WarehouseUnits[] = warehouses
    .filter((w) => w.code !== IN_TRANSIT_CODE)
    .map((w) => ({ id: w.id, name: w.name, units: perWh.get(w.id) ?? 0, isDefault: w.isDefaultWarehouse }))
    .sort((a, b) => b.units - a.units);

  let inTransitUnits = 0;
  const byDest = new Map<string, number>();
  for (const transfer of inTransit) {
    const units = transfer.lines.reduce((sum, line) => sum + line.qty, 0);
    inTransitUnits += units;
    byDest.set(transfer.destWarehouseId, (byDest.get(transfer.destWarehouseId) ?? 0) + units);
  }
  const inTransitByDest: DestUnits[] = [...byDest.entries()]
    .map(([id, units]) => ({ id, name: byId.get(id)?.name ?? id, units }))
    .sort((a, b) => b.units - a.units);

  let cycleMs = 0;
  let cycleN = 0;
  for (const t of received) {
    if (t.receivedAt && t.departedAt) {
      cycleMs += t.receivedAt.getTime() - t.departedAt.getTime();
      cycleN++;
    }
  }
  const transferCycleDays = cycleN ? Math.round((cycleMs / cycleN / 86_400_000) * 10) / 10 : null;

  const pcounts = new Map(pipelineGroups.map((g) => [g.status, g._count._all]));
  const pipeline = TRANSFER_ORDER.map((status) => ({ status, count: pcounts.get(status) ?? 0 }));

  return {
    perWarehouse,
    networkUnits,
    inTransitUnits,
    inTransitCount: inTransit.length,
    inTransitByDest,
    transfersStaged: stagedCount,
    transferCycleDays,
    pipeline,
  };
}
