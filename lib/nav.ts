import "server-only";
import { can } from "./rbac";
import type { Viewer } from "./permissions/engine";

// -----------------------------------------------------------------------------
// The navigation registry: the single source of truth for what appears in the
// nav. Each route maps to a permission-catalog RESOURCE; the shell shows a link
// iff the viewer can VIEW that resource — so nav visibility and page access are
// derived from the same permission engine (lib/permissions). NOTE: nav is still
// UX, not enforcement — every page keeps its own requireCan / requireRole guard.
// -----------------------------------------------------------------------------

export type NavGroupId =
  | "TODAY"
  | "ORDERS"
  | "SCHEDULING"
  | "OPS"
  | "INVENTORY"
  | "DEPARTMENTS"
  | "REPORTS"
  | "ADMIN";

export const GROUP_LABEL: Record<NavGroupId, string> = {
  TODAY: "Today",
  ORDERS: "Orders",
  SCHEDULING: "Scheduling",
  OPS: "Warehouse Ops",
  INVENTORY: "Inventory",
  DEPARTMENTS: "Departments",
  REPORTS: "Reports",
  ADMIN: "Admin",
};

export const GROUP_ORDER: NavGroupId[] = [
  "TODAY",
  "ORDERS",
  "SCHEDULING",
  "OPS",
  "INVENTORY",
  "DEPARTMENTS",
  "REPORTS",
  "ADMIN",
];

export type NavItem = {
  href: string;
  label: string;
  group: NavGroupId;
  /** Permission-catalog resource key; the link shows iff the viewer can view it.
   *  Omit for "any authenticated user" (e.g. Home). */
  resource?: string;
  hint?: string;
};

export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Home", group: "TODAY" },
  { href: "/profile/photo", label: "Your photo", group: "TODAY" },
  { href: "/profile/password", label: "Change password", group: "TODAY" },

  { href: "/orders", label: "Orders", group: "ORDERS", resource: "orders" },
  {
    href: "/sales-entry/new",
    label: "Log a sale",
    group: "ORDERS",
    resource: "salesentry",
    hint: "Record a completed PGI show sale for the leaderboard",
  },
  {
    href: "/sales-entry",
    label: "Sales entries",
    group: "ORDERS",
    resource: "salesentry",
    hint: "Self-reported PGI show sales (feeds the Power BI leaderboard)",
  },
  {
    href: "/orders/netsuite-review",
    label: "NetSuite review",
    group: "ORDERS",
    resource: "orders.netsuite",
    hint: "Sales orders pulled from NetSuite, waiting for accounting review",
  },

  { href: "/scheduling", label: "Calendar", group: "SCHEDULING", resource: "scheduling" },

  {
    href: "/floor",
    label: "Status board",
    group: "OPS",
    resource: "floor",
    hint: "Every in-flight trip across the pick → stage → QC → dispatch pipeline",
  },
  { href: "/staging", label: "Pick & Stage", group: "OPS", resource: "staging" },
  { href: "/qc", label: "QC", group: "OPS", resource: "qc" },
  { href: "/dispatch", label: "Dispatch", group: "OPS", resource: "dispatch" },
  { href: "/count", label: "Counts", group: "OPS", resource: "count" },

  { href: "/inventory", label: "Stock", group: "INVENTORY", resource: "inventory" },
  {
    href: "/inventory/dashboard",
    label: "Inventory dashboard",
    group: "INVENTORY",
    resource: "inventory.dashboard",
    hint: "Network-wide movement, aging and exceptions — derived from the ledger",
  },

  { href: "/manufacturing", label: "Build", group: "DEPARTMENTS", resource: "mfg" },
  { href: "/glass", label: "Glass", group: "DEPARTMENTS", resource: "glass" },
  { href: "/transfers", label: "Transfers", group: "DEPARTMENTS", resource: "transfers" },
  { href: "/returns", label: "Returns", group: "DEPARTMENTS", resource: "returns" },
  { href: "/events", label: "Shows & events", group: "DEPARTMENTS", resource: "events" },

  { href: "/dashboard", label: "Dashboards", group: "REPORTS", resource: "dashboards" },
  {
    href: "/manufacturing/report",
    label: "Manufacturing bonus",
    group: "REPORTS",
    resource: "mfg.report",
  },

  // Admin panel. `admin.*:view` seeds are ADMIN-only ([]) for the employee/user
  // directories, MANAGER for the operational admin pages (ADMIN passes as superuser).
  { href: "/admin", label: "Overview", group: "ADMIN", resource: "admin" },
  { href: "/admin/employees", label: "Employees", group: "ADMIN", resource: "admin.employees" },
  { href: "/admin/regions", label: "Regions", group: "ADMIN", resource: "admin.employees" },
  { href: "/admin/users", label: "Users & roles", group: "ADMIN", resource: "admin.users" },
  { href: "/admin/roles", label: "Roles & permissions", group: "ADMIN", resource: "admin.roles" },
  { href: "/admin/data", label: "Data imports", group: "ADMIN", resource: "admin.data" },
  { href: "/admin/locations", label: "Locations & bins", group: "ADMIN", resource: "admin.locations" },
  { href: "/admin/manufacturing", label: "Manufacturing setup", group: "ADMIN", resource: "admin.manufacturing" },
  { href: "/admin/price-lists", label: "Price lists", group: "ADMIN", resource: "admin.pricelists", hint: "Sales-entry Price List options" },
  { href: "/admin/settings", label: "Settings", group: "ADMIN", resource: "admin.settings" },
];

export type VisibleGroup = {
  id: NavGroupId;
  label: string;
  items: NavItem[];
};

/** The nav groups this viewer may see, in canonical order, empty groups dropped.
 *  A link shows iff it has no resource (public) or the viewer can view it. */
export function visibleNav(viewer: Viewer | null): VisibleGroup[] {
  const groups: VisibleGroup[] = [];
  for (const id of GROUP_ORDER) {
    const items = NAV_ITEMS.filter(
      (item) => item.group === id && (!item.resource || can(viewer, `${item.resource}:view`))
    );
    if (items.length > 0) {
      groups.push({ id, label: GROUP_LABEL[id], items });
    }
  }
  return groups;
}
