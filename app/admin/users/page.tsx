import { notFound } from "next/navigation";
import { getViewer } from "@/lib/permissions/engine";

import { can, ROLE_LABEL } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { ASSIGNABLE_ROLES } from "@/lib/roles";
import { CATALOG } from "@/lib/permissions/catalog";
import PageHeader from "@/components/ui/PageHeader";
import StatusChip from "@/components/ui/StatusChip";
import InviteUserForm from "@/components/admin/InviteUserForm";
import ResetPasswordButton from "@/components/admin/ResetPasswordButton";
import UserRolesEditor from "@/components/admin/UserRolesEditor";
import { updateUser, setUserActive, setUserOverride, removeUserOverride } from "./actions";

export const dynamic = "force-dynamic";

const ERROR_MESSAGE: Record<string, string> = {
  "last-admin":
    "That change would remove the last active administrator, so it was blocked.",
  self: "You can't deactivate your own account.",
};

// Catalog-derived helpers for the roles editor + override tools (built once).
const MENU_RESOURCES = CATALOG.filter((r) => r.href).map((r) => ({
  resource: r.key,
  label: r.label,
}));
const KEY_LABEL: Record<string, string> = Object.fromEntries(
  CATALOG.flatMap((r) => r.verbs.map((v) => [`${r.key}:${v.verb}`, `${r.label} · ${v.label}`]))
);
const ALL_KEYS = Object.keys(KEY_LABEL).sort();

function fmtDate(d: Date | null): string {
  if (!d) return "—";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const me = await getViewer();
  if (!can(me, "admin.users:view")) notFound();

  const { error } = await searchParams;

  const [users, warehouses, allGrants] = await Promise.all([
    prisma.user.findMany({
      orderBy: [{ active: "desc" }, { createdAt: "asc" }],
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        active: true,
        mustResetPassword: true,
        lastLoginAt: true,
        homeWarehouse: { select: { code: true, name: true } },
        sites: { select: { location: { select: { id: true, code: true, name: true } } } },
        roleAssignments: { select: { role: true } },
        permissionOverrides: {
          select: { permissionKey: true, effect: true },
          orderBy: { permissionKey: "asc" },
        },
      },
    }),
    prisma.location.findMany({
      where: { type: "WAREHOUSE" },
      orderBy: [{ isDefaultWarehouse: "desc" }, { name: "asc" }],
      select: { id: true, code: true, name: true },
    }),
    prisma.rolePermission.findMany({ select: { role: true, permissionKey: true } }),
  ]);

  const grantsByRole: Record<string, string[]> = {};
  for (const g of allGrants) (grantsByRole[g.role] ??= []).push(g.permissionKey);

  const roles = ASSIGNABLE_ROLES.map((value) => ({ value, label: ROLE_LABEL[value] }));

  function statusChip(u: (typeof users)[number]) {
    if (!u.active) return <StatusChip label="Inactive" tone="danger" />;
    if (u.mustResetPassword && !u.lastLoginAt)
      return <StatusChip label="Invited" tone="ember" />;
    return <StatusChip label="Active" tone="success" />;
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 space-y-8">
      <PageHeader
        eyebrow="Admin"
        title="Users & roles"
        description="Invite people, give them one or several positions, add per-person exceptions, and manage site scope. Role and permission changes take effect on that person's next page load."
      />

      {error && ERROR_MESSAGE[error] && (
        <div className="card border-danger/40 p-4 text-sm text-danger">
          {ERROR_MESSAGE[error]}
        </div>
      )}

      <InviteUserForm roles={roles} warehouses={warehouses} />

      <div className="space-y-3">
        <h2 className="text-sm font-mono uppercase tracking-widest text-muted">
          {users.length} account{users.length === 1 ? "" : "s"}
        </h2>

        {users.map((u) => {
          const siteIds = new Set(u.sites.map((s) => s.location.id));
          const isSelf = u.id === me!.id;
          const assignedRoles = u.roleAssignments.map((a) => a.role);
          const extraRoles = assignedRoles.filter((r) => r !== u.role);
          return (
            <div key={u.id} className="card p-5 space-y-4">
              <div className="flex items-start gap-3 flex-wrap">
                <div className="min-w-0">
                  <div className="font-semibold truncate">
                    {u.name || u.email}
                    {isSelf && <span className="text-muted font-normal"> (you)</span>}
                  </div>
                  {u.name && <div className="text-xs text-muted truncate">{u.email}</div>}
                </div>
                <div className="flex items-center gap-2 flex-wrap ml-auto">
                  <StatusChip label={ROLE_LABEL[u.role]} tone="teal" />
                  {extraRoles.map((r) => (
                    <StatusChip key={r} label={ROLE_LABEL[r]} tone="muted" />
                  ))}
                  {statusChip(u)}
                </div>
              </div>

              <div className="grid sm:grid-cols-3 gap-2 text-xs text-muted">
                <div>
                  <span className="block text-foreground/70">Home warehouse</span>
                  {u.homeWarehouse ? `${u.homeWarehouse.name} (${u.homeWarehouse.code})` : "Default (Ocoee)"}
                </div>
                <div>
                  <span className="block text-foreground/70">Extra sites</span>
                  {u.sites.length ? u.sites.map((s) => s.location.code).join(", ") : "—"}
                </div>
                <div>
                  <span className="block text-foreground/70">Last sign-in</span>
                  {fmtDate(u.lastLoginAt)}
                </div>
              </div>

              <details className="group">
                <summary className="cursor-pointer text-sm text-teal hover:underline">
                  Manage
                </summary>

                <form action={updateUser} className="mt-4 space-y-4">
                  <input type="hidden" name="userId" value={u.id} />

                  <UserRolesEditor
                    primaryRole={u.role}
                    assignedRoles={assignedRoles}
                    allRoles={roles}
                    grantsByRole={grantsByRole}
                    overrides={u.permissionOverrides}
                    menuResources={MENU_RESOURCES}
                    keyLabel={KEY_LABEL}
                  />

                  <label className="text-sm block">
                    <span className="text-muted">Home warehouse</span>
                    <select
                      name="homeWarehouseId"
                      defaultValue={
                        warehouses.find((w) => w.code === u.homeWarehouse?.code)?.id ?? ""
                      }
                      className="input mt-1 sm:max-w-xs"
                    >
                      <option value="">Default (Ocoee)</option>
                      {warehouses.map((w) => (
                        <option key={w.id} value={w.id}>
                          {w.name} ({w.code})
                        </option>
                      ))}
                    </select>
                  </label>

                  {warehouses.length > 0 && (
                    <fieldset className="text-sm">
                      <legend className="text-muted mb-1">Extra site scope (beyond home)</legend>
                      <div className="flex flex-wrap gap-x-4 gap-y-1">
                        {warehouses.map((w) => (
                          <label key={w.id} className="inline-flex items-center gap-1.5">
                            <input
                              type="checkbox"
                              name="siteIds"
                              value={w.id}
                              defaultChecked={siteIds.has(w.id)}
                            />
                            <span>{w.code}</span>
                          </label>
                        ))}
                      </div>
                    </fieldset>
                  )}

                  <button className="btn btn-primary" type="submit">
                    Save changes
                  </button>
                </form>

                <div className="mt-4 pt-4 border-t border-border/60 space-y-3">
                  <h4 className="text-sm font-medium">Per-user exceptions</h4>
                  {u.permissionOverrides.length === 0 ? (
                    <p className="text-xs text-muted">
                      None. Add an <strong>Allow</strong> to grant something this person's positions
                      lack, or a <strong>Deny</strong> to take something away (Deny always wins).
                    </p>
                  ) : (
                    <ul className="space-y-1">
                      {u.permissionOverrides.map((o) => (
                        <li key={o.permissionKey} className="flex items-center gap-2 text-sm">
                          <StatusChip
                            label={o.effect === "DENY" ? "Deny" : "Allow"}
                            tone={o.effect === "DENY" ? "danger" : "success"}
                          />
                          <span className="text-muted">
                            {KEY_LABEL[o.permissionKey] ?? o.permissionKey}
                          </span>
                          <form action={removeUserOverride} className="ml-auto">
                            <input type="hidden" name="userId" value={u.id} />
                            <input type="hidden" name="permissionKey" value={o.permissionKey} />
                            <button className="btn btn-ghost py-0.5 px-2 text-xs" type="submit">
                              Remove
                            </button>
                          </form>
                        </li>
                      ))}
                    </ul>
                  )}
                  <form action={setUserOverride} className="flex flex-wrap items-end gap-2">
                    <input type="hidden" name="userId" value={u.id} />
                    <label className="text-xs flex-1 min-w-48">
                      <span className="text-muted">Permission</span>
                      <input
                        name="permissionKey"
                        list="perm-keys"
                        required
                        placeholder="e.g. inventory:adjust"
                        className="input mt-1 text-sm py-1"
                      />
                    </label>
                    <select name="effect" defaultValue="ALLOW" className="input text-sm py-1 w-28">
                      <option value="ALLOW">Allow</option>
                      <option value="DENY">Deny</option>
                    </select>
                    <button className="btn btn-ghost text-sm py-1" type="submit">
                      Add exception
                    </button>
                  </form>
                </div>

                <div className="mt-4 pt-4 border-t border-border/60 flex items-end justify-between gap-3 flex-wrap">
                  <ResetPasswordButton userId={u.id} />
                  {!isSelf && (
                    <form action={setUserActive}>
                      <input type="hidden" name="userId" value={u.id} />
                      <input type="hidden" name="active" value={String(u.active)} />
                      <button
                        type="submit"
                        className={`btn py-1 px-3 text-xs ${
                          u.active ? "bg-danger text-white hover:opacity-90" : "btn-ghost"
                        }`}
                      >
                        {u.active ? "Deactivate" : "Reactivate"}
                      </button>
                    </form>
                  )}
                </div>
              </details>
            </div>
          );
        })}
      </div>

      <datalist id="perm-keys">
        {ALL_KEYS.map((k) => (
          <option key={k} value={k}>
            {KEY_LABEL[k]}
          </option>
        ))}
      </datalist>
    </div>
  );
}
