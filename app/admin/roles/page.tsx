import { notFound } from "next/navigation";
import Link from "next/link";
import type { UserRole } from "@prisma/client";
import { getViewer } from "@/lib/permissions/engine";
import { can, ROLE_LABEL } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { ASSIGNABLE_ROLES } from "@/lib/roles";
import { CATALOG } from "@/lib/permissions/catalog";
import { GROUP_ORDER, GROUP_LABEL } from "@/lib/nav";
import PageHeader from "@/components/ui/PageHeader";
import ToastOnParam from "@/components/ui/ToastOnParam";
import PermissionMatrix from "@/components/admin/PermissionMatrix";
import { setRolePermissions } from "./actions";

export const dynamic = "force-dynamic";

const CRUD = new Set<string>(["view", "edit", "delete"]);

/** Turn the catalog into the serializable, group-ordered matrix model the client renders. */
function buildGroups() {
  return GROUP_ORDER.map((gid) => {
    const rows = CATALOG.filter((r) => r.group === gid).map((r) => {
      const byVerb = new Map(r.verbs.map((v) => [v.verb, v]));
      const cell = (verb: "view" | "edit" | "delete") => {
        const v = byVerb.get(verb);
        return v ? { key: `${r.key}:${v.verb}`, label: v.label, danger: !!v.danger } : null;
      };
      return {
        key: r.key,
        label: r.label,
        isSection: !!r.parent,
        href: r.href ?? null,
        view: cell("view"),
        edit: cell("edit"),
        del: cell("delete"),
        specials: r.verbs
          .filter((v) => !CRUD.has(v.verb))
          .map((v) => ({ key: `${r.key}:${v.verb}`, label: v.label, danger: !!v.danger })),
      };
    });
    return { id: gid, label: GROUP_LABEL[gid], rows };
  }).filter((g) => g.rows.length > 0);
}

export default async function AdminRolesPage({
  searchParams,
}: {
  searchParams: Promise<{ role?: string; saved?: string }>;
}) {
  const me = await getViewer();
  if (!can(me, "admin.roles:view")) notFound();
  const canEdit = can(me, "admin.roles:edit");

  const { role: roleParam } = await searchParams;
  const selectedRole: UserRole =
    roleParam && (ASSIGNABLE_ROLES as readonly string[]).includes(roleParam)
      ? (roleParam as UserRole)
      : "MANAGER";

  const [counts, grants] = await Promise.all([
    prisma.userRoleAssignment.groupBy({ by: ["role"], _count: { role: true } }),
    prisma.rolePermission.findMany({
      where: { role: selectedRole },
      select: { permissionKey: true },
    }),
  ]);
  const countByRole = new Map(counts.map((c) => [c.role, c._count.role]));
  const grantedKeys = grants.map((g) => g.permissionKey).sort();
  const groups = buildGroups();

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 space-y-8">
      <ToastOnParam
        map={{ saved: "Permissions saved — they take effect on each person's next page load." }}
      />
      <PageHeader
        eyebrow="Admin"
        title="Roles & permissions"
        description="Pick a position, then tick what it can see and do. Turning a menu item's View off hides it and disables its other actions. Changes are live on each person's next page load. Administrators always have everything."
      />

      <div className="grid md:grid-cols-[220px_1fr] gap-6 items-start">
        <aside className="card p-2">
          {ASSIGNABLE_ROLES.map((r) => {
            const active = r === selectedRole;
            const n = countByRole.get(r) ?? 0;
            return (
              <Link
                key={r}
                href={`/admin/roles?role=${r}`}
                className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm ${
                  active ? "bg-teal/15 text-foreground font-medium" : "text-muted hover:text-foreground"
                }`}
              >
                <span className="truncate">{ROLE_LABEL[r]}</span>
                <span className="ml-auto text-xs text-muted" title={`${n} people`}>
                  {n}
                </span>
              </Link>
            );
          })}
        </aside>

        {selectedRole === "ADMIN" ? (
          <div className="card p-6 space-y-2">
            <h2 className="font-semibold">Administrator is a superuser</h2>
            <p className="text-sm text-muted">
              Administrators always hold every permission — that is deliberate and not editable here.
              To limit what someone can do, give them a different position, or add a per-user Deny on
              the{" "}
              <Link href="/admin/users" className="text-teal hover:underline">
                Users &amp; roles
              </Link>{" "}
              page.
            </p>
          </div>
        ) : (
          <PermissionMatrix
            key={`${selectedRole}:${grantedKeys.join(",")}`}
            role={selectedRole}
            roleLabel={ROLE_LABEL[selectedRole]}
            granted={grantedKeys}
            groups={groups}
            action={setRolePermissions}
            canEdit={canEdit}
          />
        )}
      </div>
    </div>
  );
}
