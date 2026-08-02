import "server-only";
import { cache } from "react";
import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getSessionUser, type SessionUser } from "@/lib/auth";
import { resolvePermissions } from "./resolve";
import type { PermissionKey } from "./catalog";

// -----------------------------------------------------------------------------
// The DB-backed permission engine. Resolves a user's EFFECTIVE permissions live
// from the DB (role assignments ∪ ALLOW − DENY, ADMIN = all), memoized per request
// via React cache(). Because it reads assignments/overrides/grants fresh each
// request, a permission or role change takes effect on the user's next page load
// (fixing the JWT "next login" limitation for the fine-grained layer).
// -----------------------------------------------------------------------------

/** The signed-in user plus their resolved permission set + every role they hold. */
export interface Viewer extends SessionUser {
  roles: UserRole[];
  perms: Set<PermissionKey>;
}

export const getEffectivePermissions = cache(
  async (userId: string): Promise<{ roles: UserRole[]; perms: Set<PermissionKey> }> => {
    const [assignments, overrides] = await Promise.all([
      prisma.userRoleAssignment.findMany({ where: { userId }, select: { role: true } }),
      prisma.userPermissionOverride.findMany({
        where: { userId },
        select: { permissionKey: true, effect: true },
      }),
    ]);
    const roles = assignments.map((a) => a.role);

    // ADMIN short-circuits to all keys in resolve(); skip the grants query for them.
    const grantsByRole: Partial<Record<UserRole, PermissionKey[]>> = {};
    if (roles.length && !roles.includes("ADMIN")) {
      const grants = await prisma.rolePermission.findMany({
        where: { role: { in: roles } },
        select: { role: true, permissionKey: true },
      });
      for (const g of grants) (grantsByRole[g.role] ??= []).push(g.permissionKey);
    }

    const perms = resolvePermissions(
      roles,
      grantsByRole,
      overrides.map((o) => ({ permissionKey: o.permissionKey, effect: o.effect }))
    );
    return { roles, perms };
  }
);

/** The current viewer (session + resolved permissions). Cached per request. */
export const getViewer = cache(async (): Promise<Viewer | null> => {
  const user = await getSessionUser();
  if (!user) return null;
  const { roles, perms } = await getEffectivePermissions(user.id);
  // Invariant: assignments ⊇ {primaryRole}. Defend against a not-yet-backfilled
  // user by falling back to the JWT role so an admin never locks themselves out.
  const allRoles = roles.length ? roles : [user.role];
  return { ...user, roles: allRoles, perms };
});

/** Synchronous permission check over an already-resolved Viewer. ADMIN is a superuser. */
export function viewerCan(viewer: Viewer | null, key: PermissionKey): boolean {
  if (!viewer) return false;
  if (viewer.role === "ADMIN" || viewer.roles.includes("ADMIN")) return true;
  return viewer.perms.has(key);
}
