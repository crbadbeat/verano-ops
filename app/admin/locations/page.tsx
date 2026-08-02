import Link from "next/link";
import { getViewer } from "@/lib/permissions/engine";
import { notFound } from "next/navigation";

import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import Uploader from "@/components/Uploader";
import PageHeader from "@/components/ui/PageHeader";
import { compareAisles, compareBins } from "@/lib/location-code";
import {
  createWarehouse,
  editWarehouse,
  createBin,
  toggleLocationActive,
  toggleOverheadExempt,
  importBins,
} from "./actions";

export const dynamic = "force-dynamic";

/** Bucket for bins whose code doesn't break into Aisle-Bay[-Level]. */
const UNSTRUCTURED = " ";

type Bin = {
  id: string;
  code: string;
  name: string;
  aisle: string | null;
  bay: string | null;
  level: number | null;
  active: boolean;
};

/** Group a warehouse's bins by aisle, in walking order rather than string order. */
function groupByAisle(bins: Bin[]): { aisle: string; bins: Bin[] }[] {
  const groups = new Map<string, Bin[]>();
  for (const b of bins) {
    const key = b.aisle ?? UNSTRUCTURED;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(b);
  }
  return [...groups.entries()]
    .sort((a, b) => {
      if (a[0] === UNSTRUCTURED) return 1;
      if (b[0] === UNSTRUCTURED) return -1;
      return compareAisles(a[0], b[0]);
    })
    .map(([aisle, list]) => ({ aisle, bins: list.sort(compareBins) }));
}

/** "bays A–J · levels 1–4", so an aisle's shape is readable without opening it. */
function describeAisle(bins: Bin[]): string {
  const bays = [...new Set(bins.map((b) => b.bay).filter(Boolean))] as string[];
  const levels = [...new Set(bins.map((b) => b.level).filter((l) => l != null))] as number[];
  const racked = bays.filter((b) => b.length === 1).sort();
  const named = bays.filter((b) => b.length > 1).sort();

  const parts: string[] = [];
  if (racked.length > 1) parts.push(`bays ${racked[0]}–${racked[racked.length - 1]}`);
  else if (racked.length === 1) parts.push(`bay ${racked[0]}`);
  if (named.length) parts.push(named.join(", ").toLowerCase());
  if (levels.length > 1) {
    const lo = Math.min(...levels);
    const hi = Math.max(...levels);
    if (lo !== hi) parts.push(`levels ${lo}–${hi}`);
  }
  return parts.join(" · ");
}

export default async function AdminLocationsPage() {
  const user = await getViewer();
  if (!can(user, "admin.locations:edit")) notFound();
  const canManage = true; // page is gated to locations.manage above

  const warehouses = await prisma.location.findMany({
    where: { type: "WAREHOUSE" },
    orderBy: { code: "asc" },
    include: { children: { orderBy: { code: "asc" } } },
  });

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 space-y-8">
      <PageHeader
        eyebrow="Admin"
        title="Locations & bins"
        description="Warehouses and bins. Print QR labels to scan during counts and picks."
        actions={
          <Link href="/admin/locations/labels" className="btn btn-ghost">
            Print all labels
          </Link>
        }
      />

      {canManage && (
        <div className="card p-5">
          <h3 className="font-semibold">New warehouse</h3>
          <form
            action={createWarehouse}
            className="mt-3 flex flex-col sm:flex-row gap-3"
          >
            <input
              name="code"
              placeholder="Code (e.g. OCOEE)"
              required
              className="input sm:max-w-[200px]"
            />
            <input name="name" placeholder="Name (optional)" className="input" />
            <button className="btn btn-primary whitespace-nowrap" type="submit">
              Add warehouse
            </button>
          </form>
        </div>
      )}

      {warehouses.length === 0 ? (
        <div className="card p-10 text-center text-muted">
          No warehouses yet. Add one above (e.g. OCOEE).
        </div>
      ) : (
        warehouses.map((w) => (
          <div key={w.id} className="card overflow-hidden">
            <div className="p-4 border-b border-border flex items-center gap-3 flex-wrap">
              <h2 className="font-semibold">{w.name}</h2>
              <span className="badge font-mono">{w.code}</span>
              <span className="badge">{w.children.length} bins</span>
              {w.children.length > 0 && (
                <span className="badge">
                  {new Set(w.children.map((b) => b.aisle ?? UNSTRUCTURED)).size} aisles
                </span>
              )}
              {w.isDefaultWarehouse && (
                <span
                  className="badge text-teal"
                  title="Warehouse-level stock here is held at locationId = null, the legacy convention every seed row was written under."
                >
                  default
                </span>
              )}
              {w.netsuiteId != null && (
                <span className="badge text-muted" title="Linked to this NetSuite location — per-warehouse cost syncs here.">
                  NetSuite #{w.netsuiteId}
                </span>
              )}
              {!w.active && <span className="badge text-danger">inactive</span>}
              <Link
                href={`/admin/locations/labels?wh=${w.id}`}
                className="btn btn-ghost py-1 px-2 text-xs ml-auto"
              >
                Print labels
              </Link>
            </div>

            {/* Rename / settings — display name is editable; code mirrors NetSuite. */}
            <details className="border-b border-border/50">
              <summary className="px-4 py-2 cursor-pointer text-sm text-muted hover:bg-surface-2/40">
                Rename / settings
              </summary>
              <div className="p-4 flex flex-wrap items-end gap-3">
                <form action={editWarehouse} className="flex items-end gap-2">
                  <input type="hidden" name="id" value={w.id} />
                  <label className="block text-sm">
                    <span className="text-xs text-muted">Display name</span>
                    <input name="name" defaultValue={w.name} required className="input mt-1 min-w-[16rem]" />
                  </label>
                  <button className="btn btn-primary" type="submit">
                    Save name
                  </button>
                </form>
                <span className="text-xs text-muted">
                  Code <span className="font-mono text-foreground">{w.code}</span> (scannable identity — mirrors NetSuite; not edited here)
                </span>
                <form action={toggleOverheadExempt} className="ml-auto">
                  <input type="hidden" name="id" value={w.id} />
                  <input type="hidden" name="exempt" value={String(w.overheadExempt)} />
                  <button
                    className={`badge ${w.overheadExempt ? "text-ember" : "text-muted"}`}
                    type="submit"
                    title="Exempt warehouses value stock at the raw NetSuite average — no landed-cost overhead added."
                  >
                    {w.overheadExempt ? "Overhead-exempt — click to apply" : "Overhead applied — click to exempt"}
                  </button>
                </form>
                <form action={toggleLocationActive}>
                  <input type="hidden" name="id" value={w.id} />
                  <input type="hidden" name="active" value={String(w.active)} />
                  <button className={`badge ${w.active ? "text-success" : "text-danger"}`} type="submit">
                    {w.active ? "Active — click to deactivate" : "Inactive — click to activate"}
                  </button>
                </form>
              </div>
            </details>

            {w.children.length > 0 &&
              groupByAisle(w.children).map(({ aisle, bins }) => (
                <details key={aisle} className="border-b border-border/50 group">
                  <summary className="px-4 py-2 cursor-pointer hover:bg-surface-2/40 flex items-center gap-3 flex-wrap text-sm">
                    <span className="font-semibold">
                      {aisle === UNSTRUCTURED ? "Ungrouped" : `Aisle ${aisle}`}
                    </span>
                    <span className="badge">{bins.length}</span>
                    <span className="text-muted text-xs">{describeAisle(bins)}</span>
                  </summary>
                  <div className="overflow-x-auto border-t border-border/50">
                    <table className="w-full text-sm">
                      <thead className="text-muted text-left">
                        <tr className="border-b border-border">
                          <th className="px-4 py-2 font-medium">Bin</th>
                          <th className="px-4 py-2 font-medium">Bay</th>
                          <th className="px-4 py-2 font-medium text-right">Level</th>
                          <th className="px-4 py-2 font-medium text-right">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {bins.map((b) => (
                          <tr key={b.id} className="border-b border-border/50">
                            <td className="px-4 py-2 font-mono text-xs">{b.code}</td>
                            <td className="px-4 py-2 text-muted">{b.bay ?? "—"}</td>
                            <td className="px-4 py-2 text-right tabular-nums text-muted">
                              {b.level ?? "—"}
                            </td>
                            <td className="px-4 py-2 text-right">
                              <form action={toggleLocationActive} className="inline">
                                <input type="hidden" name="id" value={b.id} />
                                <input
                                  type="hidden"
                                  name="active"
                                  value={String(b.active)}
                                />
                                <button
                                  className={`badge ${b.active ? "text-success" : "text-danger"}`}
                                  type="submit"
                                >
                                  {b.active ? "Active" : "Inactive"}
                                </button>
                              </form>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              ))}

            <div className="p-4 border-t border-border grid md:grid-cols-2 gap-4">
              <form action={createBin} className="flex flex-col gap-2">
                <input type="hidden" name="warehouseId" value={w.id} />
                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    name="code"
                    placeholder="New bin code (e.g. A-01)"
                    required
                    className="input"
                  />
                  <input
                    name="name"
                    placeholder="Name (optional)"
                    className="input"
                  />
                </div>
                <button className="btn btn-ghost whitespace-nowrap self-start" type="submit">
                  Add bin
                </button>
              </form>
              <Uploader
                action={importBins}
                hidden={{ warehouseId: w.id }}
                title="Import bins"
                hint="CSV/XLSX with a Bins or Code column. Codes are read as Aisle-Bay-Level (10-A-2) or Aisle-Bay (10-Floor, which is level 1)."
                cta="Import bins"
              />
            </div>
          </div>
        ))
      )}
    </div>
  );
}
