import Link from "next/link";
import { getViewer } from "@/lib/permissions/engine";
import { notFound } from "next/navigation";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { employeeName } from "@/lib/employees";
import PageHeader from "@/components/ui/PageHeader";
import StatusChip from "@/components/ui/StatusChip";
import ToastOnParam from "@/components/ui/ToastOnParam";
import { createRegion, updateRegion, setRegionShowrooms } from "./actions";

export const dynamic = "force-dynamic";

export default async function RegionsPage() {
  const me = await getViewer();
  if (!can(me, "admin.employees:view")) notFound();

  const [regions, showrooms, leaders] = await Promise.all([
    prisma.region.findMany({
      orderBy: [{ active: "desc" }, { name: "asc" }],
      include: {
        regional: { select: { name: true, preferredName: true } },
        _count: { select: { locations: true } },
      },
    }),
    prisma.location.findMany({
      where: { type: "WAREHOUSE" },
      orderBy: [{ isDefaultWarehouse: "desc" }, { name: "asc" }],
      select: { id: true, name: true, code: true, regionId: true, region: { select: { name: true } } },
    }),
    // Candidate Regionals — anyone at REGIONAL/VP level; fall back to all active.
    prisma.employee.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, firstName: true, lastName: true, preferredName: true, salesLevel: true },
    }),
  ]);

  const regionalOptions = leaders
    .filter((l) => l.salesLevel === "REGIONAL" || l.salesLevel === "VP")
    .concat(leaders.filter((l) => l.salesLevel !== "REGIONAL" && l.salesLevel !== "VP"));

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 space-y-8">
      <ToastOnParam map={{ saved: "Region saved" }} />
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <Link href="/admin/employees" className="text-muted hover:text-foreground text-sm">
          ← Employees
        </Link>
      </div>

      <PageHeader
        eyebrow="Admin"
        title="Regions"
        description="PGD territories — each Region is a Regional's set of showrooms. VPs oversee several regions (via the org chart). PGI has no regions; it groups by Show Leader."
      />

      {/* Create */}
      <form action={createRegion} className="card p-4 flex items-end gap-3 flex-wrap">
        <label className="text-sm flex-1 min-w-[12rem]">
          <span className="text-muted">New region name</span>
          <input name="name" required className="input mt-1" placeholder="e.g. South Florida" />
        </label>
        <label className="text-sm flex-1 min-w-[12rem]">
          <span className="text-muted">Regional (optional)</span>
          <select name="regionalId" defaultValue="" className="input mt-1">
            <option value="">—</option>
            {regionalOptions.map((r) => (
              <option key={r.id} value={r.id}>
                {employeeName(r)}
              </option>
            ))}
          </select>
        </label>
        <button className="btn btn-primary text-sm">Add region</button>
      </form>

      <div className="space-y-3">
        <h2 className="text-sm font-mono uppercase tracking-widest text-muted">
          {regions.length} region{regions.length === 1 ? "" : "s"}
        </h2>

        {regions.map((region) => (
          <div key={region.id} className="card p-5 space-y-4">
            <div className="flex items-center gap-3 flex-wrap">
              <span className="font-semibold">{region.name}</span>
              {!region.active && <StatusChip label="Inactive" tone="danger" />}
              <span className="text-xs text-muted">
                Regional: {region.regional?.name ?? "—"} · {region._count.locations} showroom
                {region._count.locations === 1 ? "" : "s"}
              </span>
            </div>

            <details className="group">
              <summary className="cursor-pointer text-sm text-teal hover:underline">Edit</summary>

              <div className="mt-4 space-y-4">
                <form action={updateRegion} className="flex items-end gap-3 flex-wrap">
                  <input type="hidden" name="regionId" value={region.id} />
                  <label className="text-sm flex-1 min-w-[10rem]">
                    <span className="text-muted">Name</span>
                    <input name="name" defaultValue={region.name} required className="input mt-1" />
                  </label>
                  <label className="text-sm flex-1 min-w-[10rem]">
                    <span className="text-muted">Regional</span>
                    <select name="regionalId" defaultValue={region.regionalId ?? ""} className="input mt-1">
                      <option value="">—</option>
                      {regionalOptions.map((r) => (
                        <option key={r.id} value={r.id}>
                          {employeeName(r)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex items-center gap-2 text-sm pb-2">
                    <input type="checkbox" name="active" defaultChecked={region.active} />
                    <span>Active</span>
                  </label>
                  <button className="btn btn-ghost text-sm">Save</button>
                </form>

                <form action={setRegionShowrooms} className="space-y-2">
                  <input type="hidden" name="regionId" value={region.id} />
                  <div className="text-xs text-muted">
                    Showrooms in this region (a showroom already in another region is noted):
                  </div>
                  <div className="grid sm:grid-cols-2 gap-x-4 gap-y-1">
                    {showrooms.map((s) => {
                      const inOther = s.regionId && s.regionId !== region.id;
                      return (
                        <label key={s.id} className="inline-flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            name="locationIds"
                            value={s.id}
                            defaultChecked={s.regionId === region.id}
                          />
                          <span className={inOther ? "text-muted" : ""}>
                            {s.name}
                            {inOther && (
                              <span className="text-xs text-muted"> — in {s.region?.name}</span>
                            )}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                  <button className="btn btn-primary text-sm mt-2">Save showrooms</button>
                </form>
              </div>
            </details>
          </div>
        ))}

        {regions.length === 0 && (
          <div className="card p-8 text-center text-muted text-sm">
            No regions yet. Add one above.
          </div>
        )}
      </div>
    </div>
  );
}
