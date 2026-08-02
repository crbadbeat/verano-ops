"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { UserRole } from "@prisma/client";
import { requireCan } from "@/lib/rbac";
import { getViewer } from "@/lib/permissions/engine";
import { prisma } from "@/lib/db";
import { isPermissionKey } from "@/lib/permissions/catalog";
import { ASSIGNABLE_ROLES } from "@/lib/roles";

function isAssignableRole(v: string): v is UserRole {
  return (ASSIGNABLE_ROLES as readonly string[]).includes(v);
}

/**
 * Replace a role's permission grants with exactly the submitted set (diff-write,
 * the `updateUser`/siteIds pattern). The matrix renders a control for every catalog
 * key, so the submitted set is the role's whole desired grant list.
 *
 * ADMIN is never edited here: it is a superuser via the short-circuit in
 * `resolvePermissions`/`viewerCan`, holds zero grant rows, and must stay that way.
 * Permission administration is itself ADMIN-only (`admin.roles:edit` seeds to []).
 */
export async function setRolePermissions(formData: FormData): Promise<void> {
  const admin = await getViewer();
  requireCan(admin, "admin.roles:edit");

  const role = String(formData.get("role") ?? "");
  if (!isAssignableRole(role) || role === "ADMIN") return;

  // Keep only real catalog keys — never trust the form to name a key that exists.
  const desired = new Set(
    formData.getAll("key").map(String).filter((k) => isPermissionKey(k))
  );

  const current = await prisma.rolePermission.findMany({
    where: { role },
    select: { permissionKey: true },
  });
  const currentSet = new Set(current.map((c) => c.permissionKey));
  const toRemove = [...currentSet].filter((k) => !desired.has(k));
  const toAdd = [...desired].filter((k) => !currentSet.has(k));

  if (toRemove.length || toAdd.length) {
    await prisma.$transaction([
      ...(toRemove.length
        ? [prisma.rolePermission.deleteMany({ where: { role, permissionKey: { in: toRemove } } })]
        : []),
      ...(toAdd.length
        ? [
            prisma.rolePermission.createMany({
              data: toAdd.map((permissionKey) => ({ role, permissionKey })),
              skipDuplicates: true,
            }),
          ]
        : []),
    ]);
  }

  revalidatePath("/admin/roles");
  redirect(`/admin/roles?role=${role}&saved=1`);
}
