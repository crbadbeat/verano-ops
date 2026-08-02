// -----------------------------------------------------------------------------
// PERMISSION CATALOG — the single source of truth for WHAT permissions exist.
//
// A permission key is `${resource}:${verb}`. `resource` is a menu item or a
// section within one; `verb` is view / edit / delete or a named special (approve,
// signoff, …) where plain CRUD is insufficient. WHO gets each key lives in the DB
// (RolePermission / UserPermissionOverride, admin-editable); this file only
// declares the keys, their grouping/labels for the admin matrix, and a one-time
// `seed` per key used to reproduce today's access exactly at cutover.
//
// This module is PURE (no DB, no server-only) so the resolver + tests can import it
// in the node test env.
// -----------------------------------------------------------------------------
import type { UserRole } from "@prisma/client";
import type { NavGroupId } from "@/lib/nav";

/** A permission key, `${resource}:${verb}`. Kept as a string for now; the runtime
 *  `PERMISSION_KEYS` set + registry tests guard against typos/unknown keys. */
export type PermissionKey = string;

export type Verb =
  | "view"
  | "edit"
  | "delete"
  | "approve"
  | "signoff"
  | "post"
  | "pick"
  | "mark"
  | "assign"
  | "reopen"
  | "enter"
  | "execute"
  | "record"
  | "setup"
  | "import"
  | "adjust"
  | "schedule"
  | "manage"
  | "manage_all"
  | "reset";

export interface VerbDef {
  verb: Verb;
  label: string;
  /** The roles granted this key ONCE at seed time to reproduce today's access.
   *  After seeding the DB is authoritative; this is only used by the seeder +
   *  the parity/legacy-fallback paths. `[]` = nobody by role (ADMIN still passes
   *  via the superuser short-circuit). */
  seed: UserRole[];
  danger?: boolean;
}

export interface ResourceDef {
  key: string; // resource id, e.g. "orders" or the section "orders.netsuite"
  label: string;
  group: NavGroupId;
  href?: string; // present ⇒ this resource is a nav destination
  parent?: string; // present ⇒ this resource is a section of `parent`
  verbs: VerbDef[];
}

// Role-list shorthands (readability only).
const ALL_STAFF: UserRole[] = [
  "STAFF", "MANAGER", "SALES", "CSR", "ACCOUNTING",
  "MFG_MANAGER", "WATERJET", "RETURNS", "DRIVER", "EXECUTIVE",
]; // everyone but ADMIN/PGI_SALES — the inventory:view seed

// -----------------------------------------------------------------------------
// The catalog. Each key's `seed` is the day-1 role list used ONCE to reproduce the
// original access when the DB was first seeded; after that the DB is authoritative
// (admin-editable via /admin/roles). It stays here as documentation + seeder input.
// -----------------------------------------------------------------------------
export const CATALOG: ResourceDef[] = [
  // ---- ORDERS ----
  {
    key: "orders", label: "Orders", group: "ORDERS", href: "/orders",
    verbs: [
      { verb: "view", label: "View orders", seed: ["SALES", "CSR", "MANAGER"] },
      { verb: "edit", label: "Create & edit orders", seed: ["SALES", "MANAGER"] }, // ORDER_ROLES — the real create/edit gate
      { verb: "manage", label: "Order oversight (fraud queue, flags)", seed: ["SALES", "CSR", "ACCOUNTING", "MANAGER"] }, // orders.manage
      { verb: "approve", label: "Resolve the fraud check", seed: ["MANAGER"] }, // resolveFraudCheck — MANAGER-only order oversight
      { verb: "schedule", label: "Release to scheduling", seed: ["CSR", "MANAGER"] }, // orders.schedule
      { verb: "delete", label: "Delete an order", seed: ["SALES", "MANAGER"], danger: true }, // ORDER_ROLES
    ],
  },
  {
    key: "orders.netsuite", label: "NetSuite review", group: "ORDERS", href: "/orders/netsuite-review", parent: "orders",
    verbs: [
      { verb: "view", label: "View the review queue", seed: ["ACCOUNTING", "MANAGER"] },
      { verb: "approve", label: "Approve a synced order", seed: ["ACCOUNTING", "MANAGER"] }, // orders.netsuite.review
    ],
  },
  {
    key: "salesentry", label: "PGI sales entry", group: "ORDERS", href: "/sales-entry",
    verbs: [
      { verb: "view", label: "View / log sales", seed: ["PGI_SALES", "MANAGER"] },
      { verb: "edit", label: "Log & edit own entries", seed: ["PGI_SALES", "MANAGER"] }, // sales.entry
      { verb: "manage_all", label: "View & correct ALL entries", seed: ["MANAGER"] }, // sales.entry.manage
    ],
  },

  // ---- SCHEDULING ----
  {
    key: "scheduling", label: "Scheduling calendar", group: "SCHEDULING", href: "/scheduling",
    verbs: [
      { verb: "view", label: "View the calendar", seed: ["CSR", "MANAGER"] },
      { verb: "edit", label: "Build & assign trips", seed: ["CSR", "MANAGER"] }, // SCHEDULE_ROLES (Wave 3)
    ],
  },

  // ---- WAREHOUSE OPS ----
  {
    key: "floor", label: "Status board", group: "OPS", href: "/floor",
    verbs: [{ verb: "view", label: "View the floor board", seed: ["STAFF", "MANAGER", "CSR", "DRIVER"] }],
  },
  {
    key: "staging", label: "Pick & Stage", group: "OPS", href: "/staging",
    verbs: [
      { verb: "view", label: "View pick & stage", seed: ["STAFF", "MANAGER"] },
      { verb: "pick", label: "Execute a pick", seed: ["STAFF", "MANAGER"] }, // pick.execute
      { verb: "mark", label: "Mark items staged", seed: ["STAFF", "MANAGER"] }, // stage.mark
      { verb: "assign", label: "Assign a staging lane", seed: ["MANAGER"] }, // stage.assign
      { verb: "reopen", label: "Reopen staging", seed: ["MANAGER"] }, // stage.reopen
    ],
  },
  {
    key: "qc", label: "QC", group: "OPS", href: "/qc",
    verbs: [
      { verb: "view", label: "View QC", seed: ["MANAGER"] },
      { verb: "signoff", label: "Pass QC", seed: ["MANAGER"] }, // qc.pass
    ],
  },
  {
    key: "dispatch", label: "Dispatch", group: "OPS", href: "/dispatch",
    verbs: [
      { verb: "view", label: "View dispatch", seed: ["DRIVER", "MANAGER"] },
      { verb: "signoff", label: "Sign off a delivery", seed: ["DRIVER", "MANAGER"] }, // delivery.signoff
    ],
  },
  {
    key: "count", label: "Counts", group: "OPS", href: "/count",
    verbs: [
      { verb: "view", label: "View counts", seed: ["STAFF", "MANAGER"] },
      { verb: "enter", label: "Enter a count", seed: ["STAFF", "MANAGER"] }, // count.enter
      { verb: "post", label: "Post / manage a count", seed: ["MANAGER"] }, // count.manage
    ],
  },

  // ---- INVENTORY ----
  {
    key: "inventory", label: "Stock", group: "INVENTORY", href: "/inventory",
    verbs: [
      { verb: "view", label: "View stock", seed: ALL_STAFF }, // inventory.view (page guard is authoritative)
      { verb: "adjust", label: "Adjust stock", seed: ["MANAGER"] }, // inventory.adjust
    ],
  },
  {
    key: "inventory.dashboard", label: "Inventory dashboard", group: "INVENTORY", href: "/inventory/dashboard", parent: "inventory",
    verbs: [{ verb: "view", label: "View the inventory dashboard", seed: ["MANAGER", "EXECUTIVE"] }],
  },

  // ---- DEPARTMENTS ----
  {
    key: "mfg", label: "Manufacturing (Build)", group: "DEPARTMENTS", href: "/manufacturing",
    verbs: [
      { verb: "view", label: "View build", seed: ["MFG_MANAGER", "MANAGER"] },
      { verb: "record", label: "Record production", seed: ["MFG_MANAGER", "MANAGER"] }, // mfg.record
      { verb: "setup", label: "Manufacturing setup", seed: ["MFG_MANAGER", "MANAGER"] }, // mfg.setup
    ],
  },
  {
    key: "glass", label: "Glass / Waterjet", group: "DEPARTMENTS", href: "/glass",
    verbs: [
      { verb: "view", label: "View glass", seed: ["WATERJET", "MANAGER"] },
      { verb: "execute", label: "Run glass jobs", seed: ["WATERJET", "MANAGER"] }, // glass.execute
    ],
  },
  {
    key: "transfers", label: "Transfers", group: "DEPARTMENTS", href: "/transfers",
    verbs: [
      { verb: "view", label: "View transfers", seed: ["STAFF", "MANAGER"] },
      { verb: "edit", label: "Create & receive transfers", seed: ["MANAGER"] }, // transfers.manage
    ],
  },
  {
    key: "returns", label: "Returns", group: "DEPARTMENTS", href: "/returns",
    verbs: [
      { verb: "view", label: "View returns", seed: ["RETURNS", "MANAGER"] },
      { verb: "edit", label: "Process returns", seed: ["RETURNS", "MANAGER"] }, // returns.manage
    ],
  },
  {
    key: "events", label: "Shows & events", group: "DEPARTMENTS", href: "/events",
    verbs: [
      { verb: "view", label: "View shows", seed: ["MANAGER", "EXECUTIVE"] },
      { verb: "edit", label: "Manage shows", seed: ["MANAGER", "EXECUTIVE"] }, // events.manage
    ],
  },

  // ---- REPORTS ----
  {
    key: "dashboards", label: "Dashboards", group: "REPORTS", href: "/dashboard",
    verbs: [{ verb: "view", label: "View leadership dashboards", seed: ["MANAGER", "EXECUTIVE"] }], // dashboards.view
  },
  {
    key: "dashboards.team.mfg", label: "Team board — Manufacturing", group: "REPORTS", parent: "dashboards",
    verbs: [{ verb: "view", label: "View", seed: ["MANAGER", "EXECUTIVE", "MFG_MANAGER"] }], // canDept
  },
  {
    key: "dashboards.team.glass", label: "Team board — Glass", group: "REPORTS", parent: "dashboards",
    verbs: [{ verb: "view", label: "View", seed: ["MANAGER", "EXECUTIVE", "WATERJET"] }],
  },
  {
    key: "dashboards.team.returns", label: "Team board — Returns", group: "REPORTS", parent: "dashboards",
    verbs: [{ verb: "view", label: "View", seed: ["MANAGER", "EXECUTIVE", "RETURNS"] }],
  },
  {
    key: "dashboards.team.sales", label: "Team board — Sales", group: "REPORTS", parent: "dashboards",
    verbs: [{ verb: "view", label: "View", seed: ["MANAGER", "EXECUTIVE", "SALES"] }],
  },
  {
    key: "mfg.report", label: "Manufacturing bonus", group: "REPORTS", href: "/manufacturing/report",
    verbs: [{ verb: "view", label: "View the bonus report", seed: ["MFG_MANAGER", "MANAGER"] }],
  },

  // ---- ADMIN ----
  {
    key: "admin", label: "Admin overview", group: "ADMIN", href: "/admin",
    verbs: [{ verb: "view", label: "Open the admin area", seed: ["MANAGER"] }],
  },
  {
    key: "admin.employees", label: "Employees, regions & sales centers", group: "ADMIN", href: "/admin/employees", parent: "admin",
    verbs: [{ verb: "view", label: "Manage the employee directory", seed: [] }], // admin.employees (ADMIN-only)
  },
  {
    key: "admin.users", label: "Users & roles", group: "ADMIN", href: "/admin/users", parent: "admin",
    verbs: [
      { verb: "view", label: "View users", seed: [] }, // admin.users (ADMIN-only)
      { verb: "edit", label: "Invite & edit users", seed: [], danger: true },
    ],
  },
  {
    key: "admin.roles", label: "Roles & permissions", group: "ADMIN", href: "/admin/roles", parent: "admin",
    verbs: [
      { verb: "view", label: "View roles & permissions", seed: [] }, // NEW — ADMIN-only
      { verb: "edit", label: "Edit roles & permissions", seed: [], danger: true },
    ],
  },
  {
    key: "admin.data", label: "Data imports", group: "ADMIN", href: "/admin/data", parent: "admin",
    verbs: [
      { verb: "view", label: "Run data imports", seed: ["MANAGER"] }, // page = can(catalog.import) = MANAGER
      { verb: "reset", label: "Reset hub data", seed: [], danger: true }, // /admin/reset = ADMIN-only (legacy admin.data cap)
    ],
  },
  {
    key: "admin.settings", label: "Settings", group: "ADMIN", href: "/admin/settings", parent: "admin",
    verbs: [
      { verb: "view", label: "View settings", seed: ["MANAGER"] }, // page = can(catalog.manage) = MANAGER (nav shows MANAGER)
      { verb: "edit", label: "Edit settings", seed: ["MANAGER"] },
    ],
  },
  {
    key: "admin.locations", label: "Locations & bins", group: "ADMIN", href: "/admin/locations", parent: "admin",
    verbs: [
      { verb: "view", label: "View locations", seed: ["MANAGER"] },
      { verb: "edit", label: "Edit locations & bins", seed: ["MANAGER"] }, // locations.manage
    ],
  },
  {
    key: "admin.manufacturing", label: "Manufacturing setup", group: "ADMIN", href: "/admin/manufacturing", parent: "admin",
    verbs: [
      { verb: "view", label: "View manufacturing setup", seed: ["MANAGER"] },
      { verb: "edit", label: "Edit manufacturing setup", seed: ["MANAGER"] },
    ],
  },
  {
    key: "admin.pricelists", label: "Price lists", group: "ADMIN", href: "/admin/price-lists", parent: "admin",
    verbs: [
      { verb: "view", label: "View price lists", seed: ["MANAGER"] },
      { verb: "edit", label: "Edit price lists", seed: ["MANAGER"] }, // pricelists.manage
    ],
  },
  {
    key: "catalog", label: "Product catalogue", group: "ADMIN", href: "/orders/catalogue", parent: "admin",
    verbs: [
      { verb: "import", label: "Import the catalogue", seed: ["MANAGER"] }, // catalog.import
      { verb: "edit", label: "Manage the catalogue", seed: ["MANAGER"] }, // catalog.manage
    ],
  },
];

// -----------------------------------------------------------------------------
// Derived lookups (built once at module load).
// -----------------------------------------------------------------------------
export const RESOURCE_BY_KEY: Record<string, ResourceDef> = Object.fromEntries(
  CATALOG.map((r) => [r.key, r])
);

/** key(resource, verb) → the permission-key string. */
export function permKey(resource: string, verb: Verb): PermissionKey {
  return `${resource}:${verb}`;
}

/** Every permission key that exists, in catalog order. */
export const ALL_PERMISSION_KEYS: PermissionKey[] = CATALOG.flatMap((r) =>
  r.verbs.map((v) => permKey(r.key, v.verb))
);

const KEY_SET = new Set(ALL_PERMISSION_KEYS);

/** True if `key` is a real, declared permission key. */
export function isPermissionKey(key: string): boolean {
  return KEY_SET.has(key);
}

/** role → the permission keys its SEED grants (the day-1 grant set per role). */
export const SEED_GRANTS_BY_ROLE: Record<UserRole, PermissionKey[]> = (() => {
  const out = {} as Record<UserRole, PermissionKey[]>;
  for (const r of CATALOG) {
    for (const v of r.verbs) {
      const key = permKey(r.key, v.verb);
      for (const role of v.seed) {
        (out[role] ??= []).push(key);
      }
    }
  }
  return out;
})();

/** Flat (role, permissionKey) seed pairs — what the DB seeder inserts. */
export function seedGrantPairs(): { role: UserRole; permissionKey: PermissionKey }[] {
  const pairs: { role: UserRole; permissionKey: PermissionKey }[] = [];
  for (const r of CATALOG) {
    for (const v of r.verbs) {
      for (const role of v.seed) pairs.push({ role, permissionKey: permKey(r.key, v.verb) });
    }
  }
  return pairs;
}

// The catalog is the sole source of truth. The legacy `CAPABILITIES` matrix +
// `LEGACY_CAPABILITY_MAP` (the migration bridge) were removed in Wave 5 once every
// guard resolved through the DB engine on new permission keys.
