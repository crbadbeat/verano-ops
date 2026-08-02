import Link from "next/link";
import { getViewer } from "@/lib/permissions/engine";
import { notFound } from "next/navigation";
import type { Division } from "@prisma/client";
import { can, ROLE_LABEL } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { ASSIGNABLE_ROLES } from "@/lib/roles";
import {
  employeeName,
  commissionThroughDate,
  SALES_LEVEL_LABEL,
  SEPARATION_LABEL,
  DIVISION_LABEL,
} from "@/lib/employees";
import PageHeader from "@/components/ui/PageHeader";
import AvatarUploader from "@/components/employees/AvatarUploader";
import StatusChip from "@/components/ui/StatusChip";
import { CreateLoginForm, ResetLoginPassword } from "@/components/admin/EmployeeLoginPanel";
import {
  updateEmployeeIdentity,
  updateEmployeeSeparation,
  saveAssignment,
  setDivision,
  removeDivision,
  unlinkLogin,
  linkIdentity,
  unlinkIdentity,
} from "../actions";

export const dynamic = "force-dynamic";

const ERROR_MESSAGE: Record<string, string> = {
  unique: "That email, ADP id or code already belongs to another record — nothing was saved.",
  date: "Enter the Active Date for this change.",
  cycle: "That manager choice would create a loop in the org chart.",
  link: "Couldn't link those records — the primary must be a top-level record and the alias can't already have its own linked records.",
};

/** Date → yyyy-mm-dd for a date input (dates are stored at UTC midnight). */
function ymd(d: Date | null | undefined): string {
  return d ? d.toISOString().slice(0, 10) : "";
}
function fmt(d: Date | null | undefined): string {
  return d ? d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";
}

const SALES_LEVEL_OPTIONS = [
  { value: "", label: "— not sales —" },
  { value: "REP", label: SALES_LEVEL_LABEL.REP },
  { value: "GTL", label: SALES_LEVEL_LABEL.GTL },
  { value: "REGIONAL", label: SALES_LEVEL_LABEL.REGIONAL },
  { value: "VP", label: SALES_LEVEL_LABEL.VP },
];

export default async function EmployeeDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const me = await getViewer();
  if (!can(me, "admin.employees:view")) notFound();

  const { id } = await params;
  const { error } = await searchParams;

  const emp = await prisma.employee.findUnique({
    where: { id },
    include: {
      homeLocation: { select: { name: true, code: true } },
      manager: { select: { id: true, name: true } },
      region: { select: { name: true } },
      user: { select: { id: true, email: true, active: true, lastLoginAt: true } },
      divisions: true,
      assignments: {
        orderBy: [{ effectiveDate: "desc" }, { createdAt: "desc" }],
        include: {
          homeLocation: { select: { name: true } },
          manager: { select: { name: true } },
          region: { select: { name: true } },
          createdBy: { select: { email: true } },
        },
      },
    },
  });
  if (!emp) notFound();

  const [locations, regions, managers, directReports, aliases, primary, sameName] =
    await Promise.all([
      prisma.location.findMany({
        where: { type: "WAREHOUSE" },
        orderBy: [{ isDefaultWarehouse: "desc" }, { name: "asc" }],
        select: { id: true, name: true, code: true },
      }),
      prisma.region.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
      prisma.employee.findMany({
        where: { active: true, NOT: { id } },
        orderBy: { name: "asc" },
        select: { id: true, name: true, firstName: true, lastName: true, preferredName: true },
      }),
      prisma.employee.findMany({
        where: { managerId: id, active: true },
        orderBy: { name: "asc" },
        select: { id: true, name: true, title: true, code: true, active: true, preferredName: true },
      }),
      // Records linked to this one as the same person.
      prisma.employee.findMany({
        where: { primaryId: id },
        select: { id: true, name: true, code: true, title: true },
      }),
      emp.primaryId
        ? prisma.employee.findUnique({ where: { id: emp.primaryId }, select: { id: true, name: true, code: true } })
        : null,
      // Same-name records in the other division that could be the same person.
      prisma.employee.findMany({
        where: {
          NOT: { id },
          primaryId: null,
          name: { equals: emp.name, mode: "insensitive" },
        },
        select: { id: true, name: true, code: true, title: true },
      }),
    ]);

  const roles = ASSIGNABLE_ROLES.map((value) => ({ value, label: ROLE_LABEL[value] }));
  const divByKey = new Map<Division, (typeof emp.divisions)[number]>(
    emp.divisions.map((d) => [d.division, d])
  );
  const through = commissionThroughDate(emp);

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 space-y-6">
      <Link href="/admin/employees" className="text-muted hover:text-foreground text-sm">
        ← Employees
      </Link>

      <PageHeader
        eyebrow="Employee"
        title={employeeName(emp)}
        description={emp.title ?? undefined}
        actions={
          emp.active ? (
            <StatusChip label="Active" tone="success" />
          ) : (
            <StatusChip label="Inactive" tone="danger" />
          )
        }
      />

      {error && ERROR_MESSAGE[error] && (
        <div className="card border-danger/40 p-4 text-sm text-danger">{ERROR_MESSAGE[error]}</div>
      )}

      {/* ---- Photo ---- */}
      <div className="card p-5 space-y-3">
        <h2 className="font-semibold">Photo</h2>
        <AvatarUploader employeeId={emp.id} name={employeeName(emp)} version={emp.avatarUpdatedAt?.getTime() ?? null} />
      </div>

      {/* ---- Identity ---- */}
      <form action={updateEmployeeIdentity} className="card p-5 space-y-4">
        <h2 className="font-semibold">Identity</h2>
        <input type="hidden" name="employeeId" value={emp.id} />
        <div className="grid sm:grid-cols-2 gap-3 text-sm">
          <label className="sm:col-span-2">
            <span className="text-muted">Full name *</span>
            <input name="name" defaultValue={emp.name} required className="input mt-1" />
            <span className="text-xs text-muted mt-1 block">Legal name from ADP — the payroll match key. Leave as-is.</span>
          </label>
          <label className="sm:col-span-2">
            <span className="text-muted">Preferred / display name</span>
            <input
              name="preferredName"
              defaultValue={emp.preferredName ?? ""}
              placeholder={`e.g. ${emp.name} Jr.`}
              className="input mt-1"
            />
            <span className="text-xs text-muted mt-1 block">
              Optional. Shown everywhere in the app instead of the legal name — use it to tell apart two
              people with the same name. Not touched by ADP re-imports.
            </span>
          </label>
          <label>
            <span className="text-muted">First name</span>
            <input name="firstName" defaultValue={emp.firstName ?? ""} className="input mt-1" />
          </label>
          <label>
            <span className="text-muted">Last name</span>
            <input name="lastName" defaultValue={emp.lastName ?? ""} className="input mt-1" />
          </label>
          <label>
            <span className="text-muted">Job title</span>
            <input name="title" defaultValue={emp.title ?? ""} className="input mt-1" />
          </label>
          <label>
            <span className="text-muted">Email</span>
            <input name="email" type="email" defaultValue={emp.email ?? ""} className="input mt-1" />
          </label>
          <label>
            <span className="text-muted">Phone</span>
            <input name="phone" defaultValue={emp.phone ?? ""} className="input mt-1" />
          </label>
          <label>
            <span className="text-muted">Cell</span>
            <input name="cell" defaultValue={emp.cell ?? ""} className="input mt-1" />
          </label>
          <label>
            <span className="text-muted">Employee code</span>
            <input name="code" defaultValue={emp.code ?? ""} className="input mt-1 font-mono" />
          </label>
          <label>
            <span className="text-muted">ADP id</span>
            <input name="adpId" defaultValue={emp.adpId ?? ""} className="input mt-1 font-mono" />
          </label>
          <label>
            <span className="text-muted">Hire date</span>
            <input name="hireDate" type="date" defaultValue={ymd(emp.hireDate)} className="input mt-1" />
          </label>
          <label className="flex items-center gap-2 pt-6">
            <input type="checkbox" name="active" defaultChecked={emp.active} />
            <span>Active</span>
          </label>
        </div>
        <button className="btn btn-primary text-sm">Save identity</button>
      </form>

      {/* ---- Division membership + NetSuite ids ---- */}
      <div className="card p-5 space-y-4">
        <div>
          <h2 className="font-semibold">Divisions & NetSuite ids</h2>
          <p className="text-xs text-muted mt-1">
            A person can belong to both PGI and PGD, each with its own NetSuite employee id — the id
            that ties synced sales orders back to them.
          </p>
        </div>
        <div className="grid sm:grid-cols-2 gap-4">
          {(["PGI", "PGD"] as Division[]).map((division) => {
            const cur = divByKey.get(division);
            return (
              <div key={division} className="border border-border rounded-lg p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{DIVISION_LABEL[division]}</span>
                  {cur && <span className="badge text-teal ml-auto">member</span>}
                </div>
                <form action={setDivision} className="space-y-2">
                  <input type="hidden" name="employeeId" value={emp.id} />
                  <input type="hidden" name="division" value={division} />
                  <label className="text-sm block">
                    <span className="text-muted">NetSuite employee id</span>
                    <input
                      name="netsuiteId"
                      defaultValue={cur?.netsuiteId ?? ""}
                      className="input mt-1 font-mono"
                      placeholder="e.g. 4821"
                    />
                  </label>
                  <label className="text-sm block">
                    <span className="text-muted">Active date</span>
                    <input
                      name="effectiveDate"
                      type="date"
                      defaultValue={ymd(cur?.effectiveDate)}
                      className="input mt-1"
                    />
                  </label>
                  <div className="flex gap-2">
                    <button className="btn btn-ghost text-sm">{cur ? "Save" : "Add to " + division}</button>
                  </div>
                </form>
                {cur && (
                  <form action={removeDivision}>
                    <input type="hidden" name="employeeId" value={emp.id} />
                    <input type="hidden" name="division" value={division} />
                    <button className="text-xs text-danger hover:underline">Remove from {division}</button>
                  </form>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ---- Org & sales position (effective-dated) ---- */}
      <div className="card p-5 space-y-4">
        <div>
          <h2 className="font-semibold">Org & sales position</h2>
          <p className="text-xs text-muted mt-1">
            Current: <span className="text-foreground">{emp.salesLevel ? SALES_LEVEL_LABEL[emp.salesLevel] : "not sales"}</span>
            {" · "}home {emp.homeLocation?.name ?? "—"}
            {" · "}reports to{" "}
            {emp.manager ? (
              <Link href={`/admin/employees/${emp.manager.id}`} className="text-teal hover:underline">
                {emp.manager.name}
              </Link>
            ) : (
              "—"
            )}
            {" · "}region {emp.region?.name ?? "—"}
          </p>
        </div>

        {directReports.length > 0 && (
          <div className="text-sm">
            <span className="text-muted">Direct reports ({directReports.length}): </span>
            <span className="flex flex-wrap gap-1.5 mt-1">
              {directReports.map((r) => (
                <Link
                  key={r.id}
                  href={`/admin/employees/${r.id}`}
                  className={`badge hover:text-ember ${r.active ? "" : "text-muted"}`}
                  title={r.title ?? undefined}
                >
                  {r.name}
                </Link>
              ))}
            </span>
          </div>
        )}

        <form action={saveAssignment} className="space-y-3">
          <input type="hidden" name="employeeId" value={emp.id} />
          <p className="text-sm text-muted">Record a change with its Active Date (may be backdated):</p>
          <div className="grid sm:grid-cols-2 gap-3 text-sm">
            <label>
              <span className="text-muted">Active date *</span>
              <input name="effectiveDate" type="date" required className="input mt-1" />
            </label>
            <label>
              <span className="text-muted">Sales level</span>
              <select name="salesLevel" defaultValue={emp.salesLevel ?? ""} className="input mt-1">
                {SALES_LEVEL_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="text-muted">Home site</span>
              <select name="homeLocationId" defaultValue={emp.homeLocationId ?? ""} className="input mt-1">
                <option value="">—</option>
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name} ({l.code})
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="text-muted">Reports to</span>
              <select name="managerId" defaultValue={emp.managerId ?? ""} className="input mt-1">
                <option value="">—</option>
                {managers.map((m) => (
                  <option key={m.id} value={m.id}>
                    {employeeName(m)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="text-muted">Region (PGD)</span>
              <select name="regionId" defaultValue={emp.regionId ?? ""} className="input mt-1">
                <option value="">—</option>
                {regions.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="text-muted">Note</span>
              <input name="note" className="input mt-1" placeholder="e.g. promoted to GTL" />
            </label>
          </div>
          <button className="btn btn-primary text-sm">Record change</button>
        </form>

        {emp.assignments.length > 0 && (
          <div className="border-t border-border/60 pt-3">
            <h3 className="text-xs font-mono uppercase tracking-widest text-muted mb-2">History</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-muted text-left">
                  <tr className="border-b border-border">
                    <th className="py-1.5 pr-4 font-medium">Effective</th>
                    <th className="py-1.5 pr-4 font-medium">Level</th>
                    <th className="py-1.5 pr-4 font-medium">Home</th>
                    <th className="py-1.5 pr-4 font-medium">Reports to</th>
                    <th className="py-1.5 pr-4 font-medium">Region</th>
                    <th className="py-1.5 font-medium">Note</th>
                  </tr>
                </thead>
                <tbody>
                  {emp.assignments.map((a) => (
                    <tr key={a.id} className="border-b border-border/50">
                      <td className="py-1.5 pr-4 whitespace-nowrap">{fmt(a.effectiveDate)}</td>
                      <td className="py-1.5 pr-4">{a.salesLevel ? SALES_LEVEL_LABEL[a.salesLevel] : "—"}</td>
                      <td className="py-1.5 pr-4">{a.homeLocation?.name ?? "—"}</td>
                      <td className="py-1.5 pr-4">{a.manager?.name ?? "—"}</td>
                      <td className="py-1.5 pr-4">{a.region?.name ?? "—"}</td>
                      <td className="py-1.5 text-muted">{a.note ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* ---- Separation & commissions ---- */}
      <form action={updateEmployeeSeparation} className="card p-5 space-y-4">
        <div>
          <h2 className="font-semibold">Separation & commissions</h2>
          <p className="text-xs text-muted mt-1">
            Terminated or two-weeks-notice keeps commissions flowing 30 days past the end date; quit
            with no notice stops them on the end date.
          </p>
        </div>
        <input type="hidden" name="employeeId" value={emp.id} />
        <div className="grid sm:grid-cols-2 gap-3 text-sm">
          <label>
            <span className="text-muted">End date</span>
            <input name="endDate" type="date" defaultValue={ymd(emp.endDate)} className="input mt-1" />
          </label>
          <label>
            <span className="text-muted">Separation type</span>
            <select name="separationType" defaultValue={emp.separationType ?? ""} className="input mt-1">
              <option value="">—</option>
              <option value="TERMINATED">{SEPARATION_LABEL.TERMINATED}</option>
              <option value="QUIT_WITH_NOTICE">{SEPARATION_LABEL.QUIT_WITH_NOTICE}</option>
              <option value="QUIT_NO_NOTICE">{SEPARATION_LABEL.QUIT_NO_NOTICE}</option>
            </select>
          </label>
        </div>
        {emp.endDate && (
          <p className="text-sm">
            Commissions paid through:{" "}
            <span className="font-medium text-foreground">{through ? fmt(through) : "—"}</span>
          </p>
        )}
        <button className="btn btn-primary text-sm">Save separation</button>
      </form>

      {/* ---- Identity links (same person, two payroll companies) ---- */}
      <div className="card p-5 space-y-3">
        <div>
          <h2 className="font-semibold">Identity links</h2>
          <p className="text-xs text-muted mt-1">
            The same person can appear as two payroll records (a D… and an I… id). Link them by hand —
            we never merge automatically, since names collide.
          </p>
        </div>

        {primary ? (
          <div className="text-sm flex items-center gap-2 flex-wrap">
            <span className="text-muted">This record is an alias of</span>
            <Link href={`/admin/employees/${primary.id}`} className="text-teal hover:underline">
              {primary.name}
            </Link>
            <span className="badge font-mono text-muted">{primary.code}</span>
            <form action={unlinkIdentity} className="ml-auto">
              <input type="hidden" name="aliasId" value={emp.id} />
              <button className="text-xs text-muted hover:text-danger hover:underline">Unlink</button>
            </form>
          </div>
        ) : (
          <>
            {aliases.length > 0 && (
              <div className="text-sm space-y-1">
                <span className="text-muted">Linked records (same person):</span>
                {aliases.map((a) => (
                  <div key={a.id} className="flex items-center gap-2 flex-wrap">
                    <Link href={`/admin/employees/${a.id}`} className="hover:text-ember hover:underline">
                      {a.name}
                    </Link>
                    <span className="badge font-mono text-muted">{a.code}</span>
                    <span className="text-xs text-muted">{a.title}</span>
                    <form action={unlinkIdentity}>
                      <input type="hidden" name="aliasId" value={a.id} />
                      <button className="text-xs text-muted hover:text-danger hover:underline">unlink</button>
                    </form>
                  </div>
                ))}
              </div>
            )}
            {sameName.length > 0 && (
              <div className="border-t border-border/60 pt-3 space-y-2">
                <p className="text-sm text-muted">
                  Possible same person (same name, not yet linked) — linking makes <em>this</em> record
                  the primary:
                </p>
                {sameName.map((c) => (
                  <form key={c.id} action={linkIdentity} className="flex items-center gap-2 flex-wrap text-sm">
                    <input type="hidden" name="primaryId" value={emp.id} />
                    <input type="hidden" name="aliasId" value={c.id} />
                    <span>{c.name}</span>
                    <span className="badge font-mono text-muted">{c.code}</span>
                    <span className="text-xs text-muted">{c.title}</span>
                    <button className="btn btn-ghost text-xs py-1 px-2 ml-auto">Link as same person</button>
                  </form>
                ))}
              </div>
            )}
            {aliases.length === 0 && sameName.length === 0 && (
              <p className="text-sm text-muted">No linked records, and no same-name candidates found.</p>
            )}
          </>
        )}
      </div>

      {/* ---- Login ---- */}
      <div className="card p-5 space-y-4">
        <h2 className="font-semibold">Login</h2>
        {emp.user ? (
          <div className="space-y-3 text-sm">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono">{emp.user.email}</span>
              {emp.user.active ? (
                <StatusChip label="Active" tone="success" />
              ) : (
                <StatusChip label="Disabled" tone="danger" />
              )}
              <span className="text-muted ml-auto">Last sign-in {fmt(emp.user.lastLoginAt)}</span>
            </div>
            <div className="flex items-end justify-between gap-3 flex-wrap pt-2 border-t border-border/60">
              <ResetLoginPassword employeeId={emp.id} />
              <form action={unlinkLogin}>
                <input type="hidden" name="employeeId" value={emp.id} />
                <button className="text-xs text-muted hover:text-danger hover:underline">
                  Unlink login
                </button>
              </form>
            </div>
          </div>
        ) : (
          <CreateLoginForm employeeId={emp.id} defaultEmail={emp.email} roles={roles} />
        )}
      </div>
    </div>
  );
}
