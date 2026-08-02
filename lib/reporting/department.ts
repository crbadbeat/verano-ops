import "server-only";
import { prisma } from "@/lib/db";
import { isOverdue } from "@/lib/glass";
import { remainingToCheckIn } from "@/lib/transfers";
import { isoDate, type DateRange } from "./range";

// -----------------------------------------------------------------------------
// Department leader cockpits — one metric function per department (mfg / glass /
// returns / sales). Windowed off the department's own timestamps; queue depths
// are current-state. Names are resolved here so the page just renders.
// -----------------------------------------------------------------------------

const JOB_STAGES = ["WELDING", "BOARDING", "STUCCO", "ELECTRICAL", "WRAPPING"] as const;

async function userNames(ids: string[]): Promise<Map<string, string>> {
  const clean = [...new Set(ids)];
  if (!clean.length) return new Map();
  const users = await prisma.user.findMany({
    where: { id: { in: clean } },
    select: { id: true, name: true, email: true },
  });
  return new Map(users.map((u) => [u.id, u.name || u.email]));
}

// ---- Manufacturing ----------------------------------------------------------

export interface MfgMetrics {
  unitsBuilt: number;
  jobs: number;
  mods: number;
  voidRate: number | null;
  byStage: { stage: string; count: number }[];
  bonusByWorker: { id: string; name: string; cents: number }[];
}

export async function getMfgMetrics(range: DateRange): Promise<MfgMetrics> {
  const win = { gte: range.from, lt: range.toExclusive };
  const [entries, payGroups] = await Promise.all([
    prisma.manufacturingEntry.findMany({
      where: { createdAt: win },
      select: { kind: true, stage: true, voided: true },
    }),
    prisma.manufacturingPay.groupBy({
      by: ["employeeId"],
      where: { entry: { voided: false, createdAt: win } },
      _sum: { amountCents: true },
    }),
  ]);

  const live = entries.filter((e) => !e.voided);
  const stageCounts = new Map<string, number>();
  for (const e of live) stageCounts.set(e.stage, (stageCounts.get(e.stage) ?? 0) + 1);

  const employees = payGroups.length
    ? await prisma.employee.findMany({
        where: { id: { in: payGroups.map((g) => g.employeeId) } },
        select: { id: true, name: true },
      })
    : [];
  const empName = new Map(employees.map((e) => [e.id, e.name]));

  return {
    unitsBuilt: live.filter((e) => e.kind === "JOB" && e.stage === "WRAPPING").length,
    jobs: live.filter((e) => e.kind === "JOB").length,
    mods: live.filter((e) => e.kind === "MOD").length,
    voidRate: entries.length
      ? Math.round((entries.filter((e) => e.voided).length / entries.length) * 100)
      : null,
    byStage: JOB_STAGES.map((stage) => ({ stage, count: stageCounts.get(stage) ?? 0 })),
    bonusByWorker: payGroups
      .map((g) => ({ id: g.employeeId, name: empName.get(g.employeeId) ?? "Unknown", cents: g._sum.amountCents ?? 0 }))
      .sort((a, b) => b.cents - a.cents),
  };
}

// ---- Glass / Waterjet -------------------------------------------------------

export interface GlassMetrics {
  queueDepth: number;
  overdue: number;
  completed: number;
  onTimePct: number | null;
  cutCycleHours: number | null;
  operatorScore: { id: string; name: string; count: number }[];
}

export async function getGlassMetrics(range: DateRange, now: Date): Promise<GlassMetrics> {
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const [openJobs, completed] = await Promise.all([
    prisma.glassMod.findMany({
      where: { status: { in: ["QUEUED", "IN_PROGRESS"] } },
      select: { dueDate: true },
    }),
    prisma.glassMod.findMany({
      where: { status: "COMPLETED", completedAt: { gte: range.from, lt: range.toExclusive } },
      select: { dueDate: true, completedAt: true, startedAt: true, completedById: true },
    }),
  ]);

  let onTime = 0;
  let cycleMs = 0;
  let cycleN = 0;
  const byOperator = new Map<string, number>();
  for (const g of completed) {
    if (g.completedAt && g.dueDate && isoDate(g.completedAt) <= isoDate(g.dueDate)) onTime++;
    if (g.completedAt && g.startedAt) {
      cycleMs += g.completedAt.getTime() - g.startedAt.getTime();
      cycleN++;
    }
    if (g.completedById) byOperator.set(g.completedById, (byOperator.get(g.completedById) ?? 0) + 1);
  }

  const names = await userNames([...byOperator.keys()]);

  return {
    queueDepth: openJobs.length,
    overdue: openJobs.filter((j) => isOverdue(j.dueDate, today)).length,
    completed: completed.length,
    onTimePct: completed.length ? Math.round((onTime / completed.length) * 100) : null,
    cutCycleHours: cycleN ? Math.round((cycleMs / cycleN / 3_600_000) * 10) / 10 : null,
    operatorScore: [...byOperator.entries()]
      .map(([id, count]) => ({ id, name: names.get(id) ?? "Unknown", count }))
      .sort((a, b) => b.count - a.count),
  };
}

// ---- Returns ----------------------------------------------------------------

export interface ReturnsMetrics {
  flaggedCount: number;
  outstandingUnits: number;
  closedInWindow: number;
  avgAgingDays: number | null;
  closedByStaff: { id: string; name: string; count: number }[];
}

export async function getReturnsMetrics(range: DateRange, now: Date): Promise<ReturnsMetrics> {
  const win = { gte: range.from, lt: range.toExclusive };
  const [flagged, closedGroups, closedCount] = await Promise.all([
    prisma.returnOrder.findMany({
      where: { status: "FLAGGED" },
      select: { createdAt: true, lines: { select: { expectedQty: true, checkedInQty: true } } },
    }),
    prisma.returnOrder.groupBy({ by: ["checkedInById"], where: { checkedInAt: win }, _count: { _all: true } }),
    prisma.returnOrder.count({ where: { checkedInAt: win } }),
  ]);

  let outstandingUnits = 0;
  let ageMs = 0;
  for (const r of flagged) {
    for (const line of r.lines) outstandingUnits += remainingToCheckIn(line.expectedQty, line.checkedInQty);
    ageMs += now.getTime() - r.createdAt.getTime();
  }

  const names = await userNames(closedGroups.map((g) => g.checkedInById).filter((x): x is string => x != null));

  return {
    flaggedCount: flagged.length,
    outstandingUnits,
    closedInWindow: closedCount,
    avgAgingDays: flagged.length ? Math.round(ageMs / flagged.length / 86_400_000 * 10) / 10 : null,
    closedByStaff: closedGroups
      .filter((g) => g.checkedInById)
      .map((g) => ({ id: g.checkedInById as string, name: names.get(g.checkedInById as string) ?? "Unknown", count: g._count._all }))
      .sort((a, b) => b.count - a.count),
  };
}

// ---- Sales / Showroom -------------------------------------------------------

export interface SalesMetrics {
  bookingsCents: number;
  bookingsCount: number;
  pif1Count: number;
  pflCount: number;
  fraudBacklog: number;
  bookingsByRep: { name: string; cents: number }[];
}

export async function getSalesMetrics(range: DateRange): Promise<SalesMetrics> {
  const [orders, fraudBacklog] = await Promise.all([
    prisma.order.findMany({
      // Operational department board: exclude the analytics-only historical
      // backfill (surfaced in the Sales dashboard instead).
      where: { isHistorical: false, purchasedAt: { gte: range.from, lt: range.toExclusive } },
      select: { totalCents: true, paidInFullOnePercent: true, veranoForLife: true, salesRepName: true },
    }),
    prisma.order.count({ where: { isHistorical: false, fraudCheckStatus: "REQUIRED" } }),
  ]);

  let bookingsCents = 0;
  let pif1Count = 0;
  let pflCount = 0;
  const byRep = new Map<string, number>();
  for (const o of orders) {
    bookingsCents += o.totalCents ?? 0;
    if (o.paidInFullOnePercent) pif1Count++;
    if (o.veranoForLife) pflCount++;
    const rep = o.salesRepName?.trim() || "Unattributed";
    byRep.set(rep, (byRep.get(rep) ?? 0) + (o.totalCents ?? 0));
  }

  return {
    bookingsCents,
    bookingsCount: orders.length,
    pif1Count,
    pflCount,
    fraudBacklog,
    bookingsByRep: [...byRep.entries()].map(([name, cents]) => ({ name, cents })).sort((a, b) => b.cents - a.cents),
  };
}
