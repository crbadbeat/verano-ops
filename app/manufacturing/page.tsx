import Link from "next/link";
import { redirect } from "next/navigation";
import { getViewer } from "@/lib/permissions/engine";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import ManufacturingEntryClient from "@/components/manufacturing/ManufacturingEntryClient";

export const dynamic = "force-dynamic";

export default async function ManufacturingPage() {
  const user = await getViewer();
  if (!can(user, "mfg:view")) redirect("/");
  const canManage = can(user, "admin.manufacturing:view");
  const canRecord = can(user, "mfg:record");

  const [employees, styles, reasons] = await Promise.all([
    prisma.employee.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    prisma.baseStyle.findMany({ where: { active: true }, orderBy: { code: "asc" } }),
    prisma.modReason.findMany({ where: { active: true }, orderBy: { label: "asc" } }),
  ]);

  const eOpts = employees.map((e) => ({
    id: e.id,
    label: e.code ? `${e.name} (${e.code})` : e.name,
  }));
  const sOpts = styles.map((s) => ({ id: s.id, label: `${s.code} — ${s.name}` }));
  const rOpts = reasons.map((r) => ({ id: r.id, label: r.label }));

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 space-y-6">
      <div className="flex items-center gap-3 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Manufacturing</h1>
          <p className="text-muted mt-1">
            Record a passed job or a mod — QC first, then scan.
          </p>
        </div>
        <div className="ml-auto flex gap-2 flex-wrap">
          <Link href="/manufacturing/entries" className="btn btn-ghost">
            Entries
          </Link>
          <Link href="/manufacturing/report" className="btn btn-ghost">
            Bonus report
          </Link>
          {canManage && (
            <Link href="/admin/manufacturing" className="btn btn-ghost">
              Setup
            </Link>
          )}
        </div>
      </div>

      {canRecord ? (
        <ManufacturingEntryClient employees={eOpts} styles={sOpts} reasons={rOpts} />
      ) : (
        <p className="card p-6 text-sm text-muted">
          You have view-only access to manufacturing — recording jobs is restricted.
        </p>
      )}
    </div>
  );
}
