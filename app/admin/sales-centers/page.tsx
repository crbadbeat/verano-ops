import Link from "next/link";
import { getViewer } from "@/lib/permissions/engine";
import { notFound } from "next/navigation";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import PageHeader from "@/components/ui/PageHeader";
import SalesCenterTools from "@/components/admin/SalesCenterTools";
import HistoricalBackfill from "@/components/admin/HistoricalBackfill";
import { setSalesCenter } from "./actions";

export const dynamic = "force-dynamic";

export default async function SalesCentersPage() {
  const me = await getViewer();
  if (!can(me, "admin.employees:view")) notFound();

  // Showroom Locations (sales centers only matter for showrooms), with region.
  const locations = await prisma.location.findMany({
    where: { type: "WAREHOUSE" },
    orderBy: [{ region: { name: "asc" } }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      code: true,
      netsuiteSalesCenterId: true,
      region: { select: { name: true } },
    },
  });

  const mapped = locations.filter((l) => l.netsuiteSalesCenterId != null).length;

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 space-y-6">
      <Link href="/admin/regions" className="text-muted hover:text-foreground text-sm">
        ← Regions
      </Link>
      <PageHeader
        eyebrow="Admin"
        title="Sales centers"
        description="Tie each NetSuite sales center (the selling showroom on an order) to a WMS showroom, so sales roll up Division → Region → Showroom. Auto-map by name, then fix the rest by hand."
      />

      <SalesCenterTools />
      <HistoricalBackfill />

      <div className="card overflow-hidden">
        <div className="p-4 border-b border-border flex items-center gap-3">
          <h2 className="font-semibold">Showrooms</h2>
          <span className="badge">{mapped} mapped</span>
          <span className="text-xs text-muted">of {locations.length}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-muted text-left">
              <tr className="border-b border-border">
                <th className="px-4 py-2 font-medium">Showroom</th>
                <th className="px-4 py-2 font-medium">Region</th>
                <th className="px-4 py-2 font-medium">Sales-center id</th>
              </tr>
            </thead>
            <tbody>
              {locations.map((l) => (
                <tr key={l.id} className="border-b border-border/50">
                  <td className="px-4 py-2">
                    {l.name} <span className="text-xs text-muted font-mono">{l.code}</span>
                  </td>
                  <td className="px-4 py-2 text-muted">{l.region?.name ?? "—"}</td>
                  <td className="px-4 py-2">
                    <form action={setSalesCenter} className="flex items-center gap-2">
                      <input type="hidden" name="locationId" value={l.id} />
                      <input
                        name="salesCenterId"
                        defaultValue={l.netsuiteSalesCenterId ?? ""}
                        inputMode="numeric"
                        placeholder="—"
                        className="input py-1 w-24 font-mono text-xs"
                      />
                      <button className="btn btn-ghost text-xs py-1 px-2">Save</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
