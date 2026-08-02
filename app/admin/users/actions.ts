"use server";

import { redirect } from "next/navigation";
import { requireCan } from "@/lib/rbac";
import { getViewer } from "@/lib/permissions/engine";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";
import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/db";
import { hashPassword } from "@/lib/auth";
import {
  generateInviteToken,
  randomUnusableSecret,
  INVITE_TTL_DAYS,
} from "@/lib/invite";
import { ASSIGNABLE_ROLES } from "@/lib/roles";
import { isPermissionKey } from "@/lib/permissions/catalog";

export interface InviteState {
  ok?: boolean;
  message?: string;
  /** The one-time invite link, shown once so the admin can send it. */
  inviteUrl?: string;
}

async function appOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("host") ?? "localhost:3000";
  const proto =
    h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

/** True if an active user holding ADMIN (by assignment) other than `excludeUserId`
 *  exists. Assignment-based so multi-role can't strip the last admin unnoticed. */
async function otherActiveAdminsExist(excludeUserId: string): Promise<boolean> {
  const n = await prisma.user.count({
    where: {
      active: true,
      id: { not: excludeUserId },
      roleAssignments: { some: { role: "ADMIN" } },
    },
  });
  return n > 0;
}

/** True if this user currently holds the ADMIN role by assignment. */
async function userHoldsAdmin(userId: string): Promise<boolean> {
  return (await prisma.userRoleAssignment.count({ where: { userId, role: "ADMIN" } })) > 0;
}

/** Keep only the ids that are real WAREHOUSE locations. */
async function validWarehouseIds(ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await prisma.location.findMany({
    where: { id: { in: ids }, type: "WAREHOUSE" },
    select: { id: true },
  });
  return new Set(rows.map((r) => r.id));
}

const inviteSchema = z.object({
  email: z.string().email("Enter a valid email"),
  name: z.string().trim().max(120).optional(),
  role: z.enum(ASSIGNABLE_ROLES),
  homeWarehouseId: z.string().optional(),
});

/**
 * Create a user and mint their invite link. The admin never sets a password:
 * the account gets an unusable passwordHash and a one-time PasswordResetToken,
 * and the user sets their own password via the returned link.
 */
export async function inviteUser(
  _prev: InviteState,
  formData: FormData
): Promise<InviteState> {
  const admin = await getViewer();
  try {
    requireCan(admin, "admin.users:view");
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }

  const parsed = inviteSchema.safeParse({
    email: formData.get("email"),
    name: formData.get("name") || undefined,
    role: formData.get("role"),
    homeWarehouseId: formData.get("homeWarehouseId") || undefined,
  });
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const email = parsed.data.email.toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return { ok: false, message: "An account with that email already exists." };

  let homeWarehouseId: string | null = null;
  if (parsed.data.homeWarehouseId) {
    const ok = await validWarehouseIds([parsed.data.homeWarehouseId]);
    if (!ok.has(parsed.data.homeWarehouseId)) {
      return { ok: false, message: "That home warehouse no longer exists." };
    }
    homeWarehouseId = parsed.data.homeWarehouseId;
  }

  const invite = generateInviteToken();
  await prisma.user.create({
    data: {
      email,
      name: parsed.data.name || null,
      role: parsed.data.role,
      active: true,
      mustResetPassword: true,
      passwordHash: await hashPassword(randomUnusableSecret()),
      homeWarehouseId,
      // Seed the assignment set with the invited role (invariant: assignments ⊇
      // {primary role}). The roles editor can add more positions later.
      roleAssignments: { create: { role: parsed.data.role } },
      passwordResets: {
        create: { tokenHash: invite.tokenHash, expiresAt: invite.expiresAt },
      },
    },
  });

  revalidatePath("/admin/users");
  return {
    ok: true,
    message: `Invited ${email}. Send them this link to set their password — it is valid for ${INVITE_TTL_DAYS} days and can be used once.`,
    inviteUrl: `${await appOrigin()}/invite?token=${invite.token}`,
  };
}

/**
 * Re-issue an invite (a password reset). The old password stops working
 * immediately (the hash is scrambled) and any outstanding unused tokens are
 * revoked, so the only way back in is the fresh link.
 */
export async function reissueInvite(
  _prev: InviteState,
  formData: FormData
): Promise<InviteState> {
  const admin = await getViewer();
  try {
    requireCan(admin, "admin.users:view");
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }

  const userId = String(formData.get("userId") ?? "");
  const user = userId ? await prisma.user.findUnique({ where: { id: userId } }) : null;
  if (!user) return { ok: false, message: "User not found." };

  const invite = generateInviteToken();
  await prisma.$transaction([
    prisma.passwordResetToken.deleteMany({ where: { userId, usedAt: null } }),
    prisma.user.update({
      where: { id: userId },
      data: {
        passwordHash: await hashPassword(randomUnusableSecret()),
        mustResetPassword: true,
      },
    }),
    prisma.passwordResetToken.create({
      data: { userId, tokenHash: invite.tokenHash, expiresAt: invite.expiresAt },
    }),
  ]);

  revalidatePath("/admin/users");
  return {
    ok: true,
    message: `Reset link for ${user.email} — their old password no longer works. Valid ${INVITE_TTL_DAYS} days.`,
    inviteUrl: `${await appOrigin()}/invite?token=${invite.token}`,
  };
}

function isAssignableRole(v: string): v is UserRole {
  return (ASSIGNABLE_ROLES as readonly string[]).includes(v);
}

/**
 * Update a user's role, home warehouse and extra site scope. Guards the last
 * active admin: you cannot strip the final admin's role and lock everyone out.
 */
export async function updateUser(formData: FormData): Promise<void> {
  const admin = await getViewer();
  requireCan(admin, "admin.users:view");

  const userId = String(formData.get("userId") ?? "");
  const role = String(formData.get("role") ?? "");
  const homeRaw = String(formData.get("homeWarehouseId") ?? "");
  const siteIds = formData.getAll("siteIds").map(String).filter(Boolean);
  if (!userId || !isAssignableRole(role)) return;

  // Primary role plus any additional positions ("many hats"). The set always
  // includes the primary (invariant: assignments ⊇ {primary role}).
  const extraRoles = formData.getAll("extraRoles").map(String).filter(isAssignableRole);
  const wantedRoles = new Set<UserRole>([role, ...extraRoles]);

  const target = await prisma.user.findUnique({ where: { id: userId } });
  if (!target) return;

  // Last-admin guard (assignment-based): block a change that would strip the final
  // active admin — whether ADMIN was their primary or an additional position.
  if (
    !wantedRoles.has("ADMIN") &&
    target.active &&
    (await userHoldsAdmin(userId)) &&
    !(await otherActiveAdminsExist(userId))
  ) {
    redirect("/admin/users?error=last-admin");
  }

  // Validate home + sites are real warehouses; drop anything stale.
  const home = homeRaw ? [...(await validWarehouseIds([homeRaw]))][0] ?? null : null;
  const wantedSites = new Set([...(await validWarehouseIds(siteIds))]);

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: { role, homeWarehouseId: home },
    });

    // Sync the assignment set to {primary} ∪ {additional positions} (diff-write).
    const currentAssign = await tx.userRoleAssignment.findMany({
      where: { userId },
      select: { role: true },
    });
    const currentRoles = new Set(currentAssign.map((a) => a.role));
    const rolesToRemove = [...currentRoles].filter((r) => !wantedRoles.has(r));
    const rolesToAdd = [...wantedRoles].filter((r) => !currentRoles.has(r));
    if (rolesToRemove.length) {
      await tx.userRoleAssignment.deleteMany({ where: { userId, role: { in: rolesToRemove } } });
    }
    if (rolesToAdd.length) {
      await tx.userRoleAssignment.createMany({
        data: rolesToAdd.map((r) => ({ userId, role: r })),
        skipDuplicates: true,
      });
    }

    const current = await tx.userSite.findMany({
      where: { userId },
      select: { locationId: true },
    });
    const currentIds = new Set(current.map((c) => c.locationId));
    const toRemove = [...currentIds].filter((id) => !wantedSites.has(id));
    const toAdd = [...wantedSites].filter((id) => !currentIds.has(id));
    if (toRemove.length) {
      await tx.userSite.deleteMany({ where: { userId, locationId: { in: toRemove } } });
    }
    if (toAdd.length) {
      await tx.userSite.createMany({
        data: toAdd.map((locationId) => ({ userId, locationId })),
        skipDuplicates: true,
      });
    }
  });

  revalidatePath("/admin/users");
}

/**
 * Activate / deactivate a user. A deactivated account cannot sign in (enforced
 * in the login action). You cannot deactivate yourself, nor the last active
 * admin. NOTE: a role/active change only bites on the user's next sign-in —
 * their current JWT session persists until it expires (a known limitation to be
 * closed by session versioning in a later wave).
 */
export async function setUserActive(formData: FormData): Promise<void> {
  const admin = await getViewer();
  requireCan(admin, "admin.users:view");

  const userId = String(formData.get("userId") ?? "");
  const currentlyActive = String(formData.get("active") ?? "") === "true";
  const nextActive = !currentlyActive;
  if (!userId) return;

  if (!nextActive) {
    if (userId === admin!.id) redirect("/admin/users?error=self");
    const target = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!target) return;
    if ((await userHoldsAdmin(userId)) && !(await otherActiveAdminsExist(userId))) {
      redirect("/admin/users?error=last-admin");
    }
  }

  await prisma.user.update({ where: { id: userId }, data: { active: nextActive } });
  revalidatePath("/admin/users");
}

// ---- per-user permission overrides (case-by-case Allow / Deny) --------------

/** Add or update a single per-user override. At resolve time DENY beats role grants
 *  and ALLOW overrides; ALLOW grants a permission the person's roles don't. */
export async function setUserOverride(formData: FormData): Promise<void> {
  const admin = await getViewer();
  requireCan(admin, "admin.users:view");

  const userId = String(formData.get("userId") ?? "");
  const permissionKey = String(formData.get("permissionKey") ?? "").trim();
  const effect = String(formData.get("effect") ?? "");
  if (!userId || !isPermissionKey(permissionKey)) return;
  if (effect !== "ALLOW" && effect !== "DENY") return;
  const eff = effect === "DENY" ? "DENY" : "ALLOW";

  await prisma.userPermissionOverride.upsert({
    where: { userId_permissionKey: { userId, permissionKey } },
    create: { userId, permissionKey, effect: eff },
    update: { effect: eff },
  });
  revalidatePath("/admin/users");
}

/** Remove a per-user override (back to whatever the person's roles grant). */
export async function removeUserOverride(formData: FormData): Promise<void> {
  const admin = await getViewer();
  requireCan(admin, "admin.users:view");

  const userId = String(formData.get("userId") ?? "");
  const permissionKey = String(formData.get("permissionKey") ?? "");
  if (!userId || !permissionKey) return;

  await prisma.userPermissionOverride.deleteMany({ where: { userId, permissionKey } });
  revalidatePath("/admin/users");
}
