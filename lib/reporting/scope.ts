import "server-only";
import { redirect } from "next/navigation";
import { Prisma, type UserRole } from "@prisma/client";
import { prisma } from "@/lib/db";
import { listWarehouses } from "@/lib/locations";
import { getViewer, type Viewer } from "@/lib/permissions/engine";
import { can } from "@/lib/rbac";

// -----------------------------------------------------------------------------
// Site scope for the dashboards. A warehouse's stock lives in its bins plus a
// "warehouse level" slot (locationId = null for the default Ocoee, the site's own
// id elsewhere — the convention from lib/inventory.ts / lib/locations.ts). The
// same aggregation functions serve one site or the whole network.
// -----------------------------------------------------------------------------

export interface Warehouse {
  id: string;
  code: string;
  name: string;
  isDefaultWarehouse: boolean;
}

export interface SiteScope {
  warehouse: Warehouse | null; // null when isAll
  warehouses: Warehouse[];
  locationIds: (string | null)[]; // this site's bins + its warehouse-level slot
  isAll: boolean;
}

export async function resolveSiteScope(siteParam?: string | null): Promise<SiteScope> {
  const raw = await listWarehouses();
  const warehouses: Warehouse[] = raw.map((w) => ({
    id: w.id,
    code: w.code,
    name: w.name,
    isDefaultWarehouse: w.isDefaultWarehouse,
  }));

  if (siteParam === "all") {
    return { warehouse: null, warehouses, locationIds: [], isAll: true };
  }

  let warehouse =
    (siteParam && warehouses.find((w) => w.id === siteParam || w.code === siteParam)) || null;
  if (!warehouse) {
    warehouse = warehouses.find((w) => w.isDefaultWarehouse) ?? warehouses[0] ?? null;
  }
  if (!warehouse) {
    return { warehouse: null, warehouses, locationIds: [], isAll: true };
  }

  const bins = await prisma.location.findMany({
    where: { parentId: warehouse.id },
    select: { id: true },
  });
  const locationIds: (string | null)[] = bins.map((b) => b.id);
  // The warehouse-level slot: null for the default warehouse, its own id elsewhere.
  locationIds.push(warehouse.isDefaultWarehouse ? null : warehouse.id);

  return { warehouse, warehouses, locationIds, isAll: false };
}

/** A ledger `where` fragment restricting to a site's locations (empty = all sites). */
export function siteLedgerWhere(scope: SiteScope): Prisma.InventoryLedgerWhereInput {
  if (scope.isAll) return {};
  const nonNull = scope.locationIds.filter((x): x is string => x !== null);
  const hasNull = scope.locationIds.includes(null);
  const clauses: Prisma.InventoryLedgerWhereInput[] = [];
  if (nonNull.length) clauses.push({ locationId: { in: nonNull } });
  if (hasNull) clauses.push({ locationId: null });
  return clauses.length ? { OR: clauses } : { OR: [{ locationId: { in: [] } }] };
}

export function siteSelectorOptions(scope: SiteScope): { id: string; label: string }[] {
  return scope.warehouses.map((w) => ({
    id: w.id,
    label: w.isDefaultWarehouse ? `${w.name} (default)` : w.name,
  }));
}

export function currentSiteValue(scope: SiteScope): string {
  return scope.isAll ? "all" : scope.warehouse?.id ?? "all";
}

// -----------------------------------------------------------------------------
// Access + cockpit tabs.
// -----------------------------------------------------------------------------

export interface DashboardTab {
  href: string;
  label: string;
}

/** Gate a dashboard page: signed in AND allowed the leadership dashboards. */
export async function requireDashboardUser(): Promise<Viewer> {
  const viewer = await getViewer();
  if (!viewer || !can(viewer, "dashboards:view")) redirect("/");
  return viewer;
}

export type DeptKey = "mfg" | "glass" | "returns" | "sales";

export const DEPARTMENTS: { key: DeptKey; label: string; roles: UserRole[] }[] = [
  { key: "mfg", label: "Manufacturing", roles: ["MFG_MANAGER"] },
  { key: "glass", label: "Glass", roles: ["WATERJET"] },
  { key: "returns", label: "Returns", roles: ["RETURNS"] },
  { key: "sales", label: "Sales", roles: ["SALES"] },
];

export function isDeptKey(value: string): value is DeptKey {
  return DEPARTMENTS.some((d) => d.key === value);
}

/** Leadership (dashboards.view) sees every department board; a lead sees theirs.
 *  The `dashboards.team.<key>:view` seed = [MANAGER, EXECUTIVE, <dept lead role>],
 *  reproducing the old `can(dashboards.view) || hasRole(dept.roles)`. */
export function canDept(viewer: Viewer, key: DeptKey): boolean {
  const dept = DEPARTMENTS.find((d) => d.key === key);
  if (!dept) return false;
  return can(viewer, `dashboards.team.${key}:view`);
}

/** Gate a department board: leadership, or the department's own lead. */
export async function requireDepartmentUser(key: DeptKey): Promise<Viewer> {
  const viewer = await getViewer();
  if (!viewer || !canDept(viewer, key)) redirect("/");
  return viewer;
}

/** Cockpit tabs for this user: leadership boards if allowed, plus reachable depts. */
export function dashboardTabs(viewer: Viewer): DashboardTab[] {
  const tabs: DashboardTab[] = [];
  if (can(viewer, "dashboards:view")) {
    tabs.push(
      { href: "/dashboard/warehouse", label: "Warehouse" },
      { href: "/dashboard/network", label: "Network" },
      { href: "/dashboard/exec", label: "Executive" },
      { href: "/dashboard/sales", label: "Sales" },
      { href: "/dashboard/people", label: "People" },
      { href: "/dashboard/exceptions", label: "Exceptions" }
    );
  }
  for (const dept of DEPARTMENTS) {
    if (canDept(viewer, dept.key)) {
      tabs.push({ href: `/dashboard/team/${dept.key}`, label: dept.label });
    }
  }
  return tabs;
}
