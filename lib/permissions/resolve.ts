// -----------------------------------------------------------------------------
// PURE permission resolution (no DB, no server-only) so it is unit-testable and
// can also run client-side for the live "effective permissions" preview.
//
// Precedence (deny-wins):
//   ADMIN short-circuit  →  override DENY  →  (role grants ∪ override ALLOW)  →  default deny
// Role grants are ALLOW-only (union across all assigned roles); DENY exists ONLY
// at the per-user override tier, and always beats a role grant or an ALLOW override.
// -----------------------------------------------------------------------------
import type { UserRole } from "@prisma/client";
import { ALL_PERMISSION_KEYS, type PermissionKey } from "./catalog";

export type OverrideEffect = "ALLOW" | "DENY";
export interface OverrideInput {
  permissionKey: string;
  effect: OverrideEffect;
}

/**
 * Resolve a person's effective permission set.
 * @param assignedRoles every role the user holds (multi-role).
 * @param grantsByRole  role → permission keys it grants (from RolePermission, or the seed).
 * @param overrides     per-user ALLOW/DENY exceptions.
 */
export function resolvePermissions(
  assignedRoles: UserRole[],
  grantsByRole: Partial<Record<UserRole, PermissionKey[]>>,
  overrides: OverrideInput[] = []
): Set<PermissionKey> {
  // ADMIN is a superuser — holds every declared permission.
  if (assignedRoles.includes("ADMIN")) return new Set(ALL_PERMISSION_KEYS);

  const allow = new Set<PermissionKey>();
  for (const role of assignedRoles) {
    for (const key of grantsByRole[role] ?? []) allow.add(key);
  }
  // ALLOW overrides add; DENY overrides remove (applied last, so deny wins).
  for (const o of overrides) if (o.effect === "ALLOW") allow.add(o.permissionKey);
  for (const o of overrides) if (o.effect === "DENY") allow.delete(o.permissionKey);
  return allow;
}

/** Whether a resolved permission set (already computed) allows a key. */
export function permsHas(perms: Set<PermissionKey>, key: PermissionKey): boolean {
  return perms.has(key);
}
