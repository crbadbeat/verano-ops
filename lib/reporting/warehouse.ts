import "server-only";
import { prisma } from "@/lib/db";
import { stagingDateForLoadDate } from "@/lib/scheduling";
import { isoDate, type DateRange } from "./range";
import { siteLedgerWhere, type SiteScope } from "./scope";

// -----------------------------------------------------------------------------
// Warehouse Manager cockpit metrics. Everything is derived at request time from
// the DeliveryTrip lifecycle, the order book, and the InventoryLedger — no stored
// counters. Trips have no site field yet (Ocoee is the only staging origin), so
// trip KPIs are warehouse-wide; the inventory-health tiles honour the site scope.
// -----------------------------------------------------------------------------

export interface WorkerRow {
  id: string;
  name: string;
  pickedUnits: number;
  countEntries: number;
}

export interface WarehouseMetrics {
  onTimeToStagePct: number | null;
  stagedCount: number;
  stagingCycleHours: number | null;
  atRiskCount: number;
  unscheduledBacklog: number;
  negativeSlots: number;
  outOfStock: number;
  stagedPerDay: { label: string; value: number }[];
  unitsStagedPerDay: { label: string; value: number }[];
  workers: WorkerRow[];
}

/** Every yyyy-mm-dd in [from, toExclusive), so trend series have zero-filled days. */
function dayBuckets(range: DateRange): string[] {
  const days: string[] = [];
  const cursor = new Date(range.from.getTime());
  while (cursor.getTime() < range.toExclusive.getTime()) {
    days.push(isoDate(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

export async function getWarehouseMetrics(
  range: DateRange,
  scope: SiteScope,
  now: Date
): Promise<WarehouseMetrics> {
  const today = isoDate(
    new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  );
  const days = dayBuckets(range);

  const [stagedTrips, finalizedOpen, unscheduledBacklog, slots, pickRows, countGroups] =
    await Promise.all([
      prisma.deliveryTrip.findMany({
        where: { stagedAt: { gte: range.from, lt: range.toExclusive } },
        select: { id: true, loadDate: true, finalizedAt: true, stagedAt: true },
      }),
      prisma.deliveryTrip.findMany({
        where: { status: "FINALIZED", stagedAt: null },
        select: { id: true, loadDate: true },
      }),
      prisma.order.count({ where: { status: "CONFIRMED", deliveryTripId: null } }),
      prisma.inventoryLedger.groupBy({
        by: ["productId", "locationId", "condition"],
        where: siteLedgerWhere(scope),
        _sum: { qtyDelta: true },
      }),
      prisma.inventoryLedger.findMany({
        where: {
          reason: "PICK",
          qtyDelta: { gt: 0 },
          createdAt: { gte: range.from, lt: range.toExclusive },
        },
        select: { createdAt: true, qtyDelta: true, createdById: true },
      }),
      prisma.countEntry.groupBy({
        by: ["countedById"],
        where: { countedAt: { gte: range.from, lt: range.toExclusive } },
        _count: { _all: true },
      }),
    ]);

  // On-time to stage + finalize->staged cycle time.
  let onTime = 0;
  let cycleTotalMs = 0;
  let cycleN = 0;
  for (const trip of stagedTrips) {
    if (trip.stagedAt && isoDate(trip.stagedAt) <= isoDate(stagingDateForLoadDate(trip.loadDate))) {
      onTime++;
    }
    if (trip.stagedAt && trip.finalizedAt) {
      cycleTotalMs += trip.stagedAt.getTime() - trip.finalizedAt.getTime();
      cycleN++;
    }
  }
  const onTimeToStagePct = stagedTrips.length
    ? Math.round((onTime / stagedTrips.length) * 100)
    : null;
  const stagingCycleHours = cycleN
    ? Math.round((cycleTotalMs / cycleN / 3_600_000) * 10) / 10
    : null;

  // At-risk: finalized, not yet staged, stage-by date already passed.
  const atRiskCount = finalizedOpen.filter(
    (trip) => isoDate(stagingDateForLoadDate(trip.loadDate)) < today
  ).length;

  // Inventory health from the site-scoped slots.
  let negativeSlots = 0;
  const perProduct = new Map<string, number>();
  for (const slot of slots) {
    const qty = slot._sum.qtyDelta ?? 0;
    if (qty < 0) negativeSlots++;
    perProduct.set(slot.productId, (perProduct.get(slot.productId) ?? 0) + qty);
  }
  const outOfStock = [...perProduct.values()].filter((v) => v <= 0).length;

  // Trends + per-worker picks (a PICK writes +qty into the lane; sum the +legs).
  const stagedByDay = new Map<string, number>();
  for (const trip of stagedTrips) {
    if (trip.stagedAt) {
      const key = isoDate(trip.stagedAt);
      stagedByDay.set(key, (stagedByDay.get(key) ?? 0) + 1);
    }
  }
  const unitsByDay = new Map<string, number>();
  const pickedByWorker = new Map<string, number>();
  for (const row of pickRows) {
    const key = isoDate(row.createdAt);
    unitsByDay.set(key, (unitsByDay.get(key) ?? 0) + row.qtyDelta);
    if (row.createdById) {
      pickedByWorker.set(row.createdById, (pickedByWorker.get(row.createdById) ?? 0) + row.qtyDelta);
    }
  }
  const stagedPerDay = days.map((d) => ({ label: d.slice(5), value: stagedByDay.get(d) ?? 0 }));
  const unitsStagedPerDay = days.map((d) => ({ label: d.slice(5), value: unitsByDay.get(d) ?? 0 }));

  // People: merge picks + count entries and resolve names.
  const countByWorker = new Map<string, number>();
  for (const group of countGroups) {
    if (group.countedById) countByWorker.set(group.countedById, group._count._all);
  }
  const workerIds = new Set<string>([...pickedByWorker.keys(), ...countByWorker.keys()]);
  const users = workerIds.size
    ? await prisma.user.findMany({
        where: { id: { in: [...workerIds] } },
        select: { id: true, name: true, email: true },
      })
    : [];
  const nameById = new Map(users.map((u) => [u.id, u.name || u.email]));
  const workers: WorkerRow[] = [...workerIds]
    .map((id) => ({
      id,
      name: nameById.get(id) ?? "Unknown",
      pickedUnits: pickedByWorker.get(id) ?? 0,
      countEntries: countByWorker.get(id) ?? 0,
    }))
    .sort((a, b) => b.pickedUnits - a.pickedUnits || b.countEntries - a.countEntries);

  return {
    onTimeToStagePct,
    stagedCount: stagedTrips.length,
    stagingCycleHours,
    atRiskCount,
    unscheduledBacklog,
    negativeSlots,
    outOfStock,
    stagedPerDay,
    unitsStagedPerDay,
    workers,
  };
}
