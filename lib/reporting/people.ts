import "server-only";
import { prisma } from "@/lib/db";
import type { DateRange } from "./range";

// -----------------------------------------------------------------------------
// People & accountability scorecard. Every ledger row and department table
// already stamps who did the work — this rolls it up per person. NOTE: there are
// three UNJOINED identity systems (app User, payroll Employee, free-text sales/
// driver names). This surfaces the User activity and the Employee payroll as
// SEPARATE tables and labels the seam rather than fabricating a join.
// -----------------------------------------------------------------------------

export interface PersonRow {
  id: string;
  name: string;
  picks: number; // units picked
  counts: number; // count entries
  glassCuts: number;
  returnsClosed: number;
  tripsStaged: number;
  mfgRecorded: number;
  total: number; // simple activity sum, for ranking
}

export interface EmployeePayRow {
  id: string;
  name: string;
  cents: number;
}

export interface PeopleMetrics {
  people: PersonRow[];
  payroll: EmployeePayRow[];
}

export async function getPeopleMetrics(range: DateRange): Promise<PeopleMetrics> {
  const win = { gte: range.from, lt: range.toExclusive };

  const [pickRows, countGroups, glassGroups, returnGroups, tripGroups, mfgGroups, payGroups] =
    await Promise.all([
      prisma.inventoryLedger.findMany({
        where: { reason: "PICK", qtyDelta: { gt: 0 }, createdAt: win },
        select: { qtyDelta: true, createdById: true },
      }),
      prisma.countEntry.groupBy({ by: ["countedById"], where: { countedAt: win }, _count: { _all: true } }),
      prisma.glassMod.groupBy({
        by: ["completedById"],
        where: { status: "COMPLETED", completedAt: win },
        _count: { _all: true },
      }),
      prisma.returnOrder.groupBy({
        by: ["checkedInById"],
        where: { checkedInAt: win },
        _count: { _all: true },
      }),
      prisma.deliveryTrip.groupBy({ by: ["stagedById"], where: { stagedAt: win }, _count: { _all: true } }),
      prisma.manufacturingEntry.groupBy({
        by: ["createdById"],
        where: { voided: false, createdAt: win },
        _count: { _all: true },
      }),
      prisma.manufacturingPay.groupBy({
        by: ["employeeId"],
        where: { entry: { voided: false, createdAt: win } },
        _sum: { amountCents: true },
      }),
    ]);

  const rows = new Map<string, PersonRow>();
  const ensure = (id: string): PersonRow => {
    let row = rows.get(id);
    if (!row) {
      row = {
        id,
        name: id,
        picks: 0,
        counts: 0,
        glassCuts: 0,
        returnsClosed: 0,
        tripsStaged: 0,
        mfgRecorded: 0,
        total: 0,
      };
      rows.set(id, row);
    }
    return row;
  };

  for (const p of pickRows) if (p.createdById) ensure(p.createdById).picks += p.qtyDelta;
  for (const g of countGroups) if (g.countedById) ensure(g.countedById).counts += g._count._all;
  for (const g of glassGroups) if (g.completedById) ensure(g.completedById).glassCuts += g._count._all;
  for (const g of returnGroups) if (g.checkedInById) ensure(g.checkedInById).returnsClosed += g._count._all;
  for (const g of tripGroups) if (g.stagedById) ensure(g.stagedById).tripsStaged += g._count._all;
  for (const g of mfgGroups) if (g.createdById) ensure(g.createdById).mfgRecorded += g._count._all;

  const userIds = [...rows.keys()];
  const users = userIds.length
    ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true } })
    : [];
  const nameById = new Map(users.map((u) => [u.id, u.name || u.email]));
  for (const row of rows.values()) {
    row.name = nameById.get(row.id) ?? "Unknown";
    row.total =
      row.picks + row.counts + row.glassCuts + row.returnsClosed + row.tripsStaged + row.mfgRecorded;
  }

  const empIds = payGroups.map((g) => g.employeeId);
  const employees = empIds.length
    ? await prisma.employee.findMany({ where: { id: { in: empIds } }, select: { id: true, name: true } })
    : [];
  const empName = new Map(employees.map((e) => [e.id, e.name]));
  const payroll: EmployeePayRow[] = payGroups
    .map((g) => ({ id: g.employeeId, name: empName.get(g.employeeId) ?? "Unknown", cents: g._sum.amountCents ?? 0 }))
    .sort((a, b) => b.cents - a.cents);

  const people = [...rows.values()].sort((a, b) => b.total - a.total);
  return { people, payroll };
}
