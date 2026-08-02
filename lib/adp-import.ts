import "server-only";
import { prisma } from "./db";
import {
  parseAdpRows,
  inScope,
  mapAdpRow,
  normLocation,
  LOCATION_ALIASES,
  isNonShowroomLocation,
  type MappedEmployee,
} from "./adp";

// -----------------------------------------------------------------------------
// ADP employee import/sync (the DB side; pure mapping lives in lib/adp). Upserts
// each in-scope row as its own Employee keyed on the D/I division code — no
// auto-merge (names collide; link the same person's two records by hand). Runs
// idempotently, so this is also the daily-sync path.
//
// Identity, salary and separation refresh on every run; the org cache
// (salesLevel / homeLocation) is written only on CREATE, so a re-sync never
// clobbers org changes made in-app afterward.
// -----------------------------------------------------------------------------

export interface AdpImportSummary {
  totalRows: number;
  inScope: number;
  created: number;
  updated: number;
  withSalary: number;
  skippedUnknownCode: number;
  unmatchedLocations: { name: string; count: number }[];
}

export async function importAdpEmployees(text: string, now: Date): Promise<AdpImportSummary> {
  const allRows = parseAdpRows(text);
  const scoped = allRows.filter((r) => inScope(r, now));
  const mappedAll = scoped.map(mapAdpRow).filter((m): m is MappedEmployee => m !== null);
  const skippedUnknownCode = scoped.length - mappedAll.length;

  // Dedupe by divisionCode (unique), last row wins.
  const byCode = new Map<string, MappedEmployee>();
  for (const m of mappedAll) byCode.set(m.divisionCode, m);
  const mapped = [...byCode.values()];

  const locs = await prisma.location.findMany({
    where: { type: "WAREHOUSE" },
    select: { id: true, name: true },
  });
  const idByNorm = new Map(locs.map((l) => [normLocation(l.name), l.id]));
  const resolveHome = (raw: string | null): string | null => {
    if (!raw || isNonShowroomLocation(raw)) return null;
    const alias = LOCATION_ALIASES[raw.toLowerCase()];
    return idByNorm.get(normLocation(raw)) ?? (alias ? idByNorm.get(normLocation(alias)) ?? null : null);
  };

  let created = 0;
  let updated = 0;
  let withSalary = 0;
  const unmatched = new Map<string, number>();

  for (const m of mapped) {
    const homeLocationId = resolveHome(m.homeLocationRaw);
    if (m.homeLocationRaw && !isNonShowroomLocation(m.homeLocationRaw) && !homeLocationId) {
      unmatched.set(m.homeLocationRaw, (unmatched.get(m.homeLocationRaw) ?? 0) + 1);
    }
    if (m.annualSalaryCents != null || m.payRateCents != null) withSalary++;

    const common = {
      name: m.name,
      firstName: m.firstName,
      lastName: m.lastName,
      title: m.title,
      active: m.active,
      hireDate: m.hireDate,
      endDate: m.endDate,
      separationType: m.separationType,
      supervisorName: m.supervisorName,
      annualSalaryCents: m.annualSalaryCents,
      payRateCents: m.payRateCents,
      payClass: m.payClass,
      payStructure: m.payStructure,
    };

    const existing = await prisma.employee.findUnique({
      where: { code: m.divisionCode },
      select: { id: true },
    });
    const emp = await prisma.employee.upsert({
      where: { code: m.divisionCode },
      create: { code: m.divisionCode, homeLocationId, salesLevel: m.salesLevel, ...common },
      update: common, // org-cache fields deliberately omitted on update
      select: { id: true },
    });
    if (existing) updated++;
    else created++;

    await prisma.employeeDivision.upsert({
      where: { divisionCode: m.divisionCode },
      create: { employeeId: emp.id, division: m.division, divisionCode: m.divisionCode },
      update: { employeeId: emp.id, division: m.division },
    });
  }

  return {
    totalRows: allRows.length,
    inScope: scoped.length,
    created,
    updated,
    withSalary,
    skippedUnknownCode,
    unmatchedLocations: [...unmatched.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count),
  };
}
