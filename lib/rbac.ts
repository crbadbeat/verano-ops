import "server-only";
import type { UserRole } from "@prisma/client";
import type { PermissionKey } from "./permissions/catalog";
import { viewerCan, type Viewer } from "./permissions/engine";

// -----------------------------------------------------------------------------
// Authorization surface. Every guard resolves a person's EFFECTIVE permissions
// through the DB engine (multi-role grants ∪ ALLOW − DENY, ADMIN = superuser),
// live per request. `can`/`requireCan` take a Viewer (from getViewer()) and a
// permission key declared in the catalog (unknown key = a dead grant, never true).
// The catalog is the single source of truth for WHAT keys exist; the DB tables for
// WHO holds them. (The legacy CAPABILITIES matrix + dual-mode bridge were removed
// in Wave 5.)
// -----------------------------------------------------------------------------

export type { PermissionKey };

/** True if the viewer is allowed the permission (ADMIN always is). */
export function can(viewer: Viewer | null, key: PermissionKey): boolean {
  return viewerCan(viewer, key);
}

/** Throw unless the viewer is allowed the permission (for server actions).
 *  Returns the viewer so call sites can keep a narrowed, non-null reference. */
export function requireCan(viewer: Viewer | null, key: PermissionKey): Viewer {
  if (!viewer) throw new Error("Not authenticated");
  if (!viewerCan(viewer, key)) throw new Error("Not authorized");
  return viewer;
}

// Human-friendly role names for the UI. A `Record<UserRole, …>` on purpose: when a
// new role is added to the enum, TypeScript flags this as incomplete until it is
// labelled here.
export const ROLE_LABEL: Record<UserRole, string> = {
  ADMIN: "Administrator",
  MANAGER: "Warehouse Manager",
  STAFF: "Warehouse Staff",
  CSR: "CSR / Scheduler",
  SALES: "Sales",
  ACCOUNTING: "Accounting",
  MFG_MANAGER: "Manufacturing Lead",
  WATERJET: "Glass / Waterjet",
  RETURNS: "Returns Desk",
  DRIVER: "Driver",
  EXECUTIVE: "Executive",
  PGI_SALES: "PGI Sales Rep",
};
