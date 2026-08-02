import "server-only";
import { prisma } from "@/lib/db";
import { seedGrantPairs } from "./catalog";

// -----------------------------------------------------------------------------
// One-time (idempotent) seed that reproduces today's access in the DB: insert the
// catalog's per-key seed grants into RolePermission, and give every existing user
// an assignment for their primary User.role. Safe to re-run (skipDuplicates).
// Run once AFTER migration 40_permissions and BEFORE any surface reads the DB path.
// -----------------------------------------------------------------------------
export async function seedPermissions(): Promise<{
  grantsCreated: number;
  grantsTotal: number;
  assignmentsCreated: number;
}> {
  const pairs = seedGrantPairs();
  const before = await prisma.rolePermission.count();
  await prisma.rolePermission.createMany({
    data: pairs.map((p) => ({ role: p.role, permissionKey: p.permissionKey })),
    skipDuplicates: true,
  });
  const grantsTotal = await prisma.rolePermission.count();

  // Ensure every user holds an assignment for their primary role (the invariant
  // assignments ⊇ {primaryRole}); the migration also backfills this — idempotent.
  const users = await prisma.user.findMany({ select: { id: true, role: true } });
  const res = await prisma.userRoleAssignment.createMany({
    data: users.map((u) => ({ userId: u.id, role: u.role })),
    skipDuplicates: true,
  });

  return { grantsCreated: grantsTotal - before, grantsTotal, assignmentsCreated: res.count };
}
