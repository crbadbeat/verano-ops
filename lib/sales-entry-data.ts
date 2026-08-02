import "server-only";
import { prisma } from "@/lib/db";
import { employeeName } from "@/lib/employees";

// Server-only loaders for the PGI sales-entry form. Kept apart from lib/sales-entry
// (which is pure + client-importable) so a client component never pulls in Prisma.

export interface EmployeeOption {
  id: string;
  name: string;
  code: string | null;
}

export interface ShowOption {
  id: string;
  name: string;
  leaderEmployeeId: string | null; // the show's leader (read-only on the form)
  leaderName: string | null;
  // The show's assigned staff + its leader (scopes the rep pickers). Carries each
  // member's own name/code so a rep on the roster shows even if they aren't in the
  // global active-PGI-employee list (a different division, inactive, etc.).
  roster: EmployeeOption[];
}

export interface SalesEntryFormData {
  shows: ShowOption[];
  employees: EmployeeOption[]; // PGI employees — reps and second reps
  priceLists: string[]; // active admin-managed Price List options
}

const DAY = 86_400_000;

/**
 * Form pickers. Shows are limited to their "active window" — from 1 day BEFORE a
 * span starts to 3 days AFTER it ends — so reps can't stack deals on the wrong
 * show to chase a goal. `includeShowId` force-includes one show regardless of the
 * window (so an edit can still show the entry's own show).
 */
export async function getSalesEntryFormData(
  opts: { includeShowId?: string | null } = {}
): Promise<SalesEntryFormData> {
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const openFrom = new Date(today.getTime() + DAY); // startDate must be <= today + 1 day
  const closeAfter = new Date(today.getTime() - 3 * DAY); // endDate must be >= today - 3 days

  const inWindow = {
    status: { not: "CANCELLED" as const },
    dates: { some: { startDate: { lte: openFrom }, endDate: { gte: closeAfter } } },
  };
  const showWhere = opts.includeShowId
    ? { OR: [inWindow, { id: opts.includeShowId }] }
    : inWindow;

  const [shows, employees, priceLists] = await Promise.all([
    prisma.showEvent.findMany({
      where: showWhere,
      orderBy: { name: "asc" },
      select: {
        id: true, name: true, leaderEmployeeId: true,
        leader: { select: { id: true, name: true, code: true, preferredName: true } },
        staff: { select: { employee: { select: { id: true, name: true, code: true, preferredName: true } } } },
      },
    }),
    prisma.employee.findMany({
      where: { active: true, divisions: { some: { division: "PGI" } } },
      orderBy: { name: "asc" },
      select: { id: true, name: true, code: true, preferredName: true },
    }),
    prisma.priceList.findMany({
      where: { active: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { name: true },
    }),
  ]);
  return {
    shows: shows.map((s) => {
      // Roster = assigned staff + the leader (leader counts as a rep), deduped.
      const roster: EmployeeOption[] = [];
      const seen = new Set<string>();
      const add = (e: { id: string; name: string; code: string | null; preferredName: string | null } | null | undefined) => {
        if (!e || seen.has(e.id)) return;
        seen.add(e.id);
        roster.push({ id: e.id, name: employeeName(e), code: e.code });
      };
      for (const st of s.staff) add(st.employee);
      add(s.leader);
      roster.sort((a, b) => a.name.localeCompare(b.name));
      return {
        id: s.id,
        name: s.name,
        leaderEmployeeId: s.leaderEmployeeId,
        leaderName: s.leader ? employeeName(s.leader) : null,
        roster,
      };
    }),
    employees: employees.map((e) => ({ id: e.id, name: employeeName(e), code: e.code })),
    priceLists: priceLists.map((p) => p.name),
  };
}
