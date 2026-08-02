import Link from "next/link";
import { redirect } from "next/navigation";
import { getViewer } from "@/lib/permissions/engine";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import SkuDatalist from "@/components/SkuDatalist";
import Uploader from "@/components/Uploader";
import { addBomComponent, removeBomComponent, importBom } from "./actions";

export const dynamic = "force-dynamic";

export default async function BomPage({
  searchParams,
}: {
  searchParams: Promise<{ sku?: string }>;
}) {
  const user = await getViewer();
  if (!can(user, "admin.manufacturing:view")) redirect("/manufacturing");

  const { sku } = await searchParams;
  const parent = sku
    ? await prisma.product.findUnique({
        where: { sku },
        include: {
          bomParentOf: { include: { component: true }, orderBy: { id: "asc" } },
        },
      })
    : null;

  const allSkus = await prisma.product.findMany({
    where: { active: true },
    select: { sku: true, displayName: true, name: true },
    orderBy: { sku: "asc" },
  });

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 space-y-6">
      <div className="flex items-center gap-3 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Bill of materials</h1>
          <p className="text-muted mt-1">
            Components each finished base consumes at Wrapping.
          </p>
        </div>
        <Link href="/admin/manufacturing" className="btn btn-ghost ml-auto">
          Back to setup
        </Link>
      </div>

      <SkuDatalist id="all-skus" products={allSkus} />

      <Uploader
        action={importBom}
        title="Import BOM"
        hint="CSV/XLSX with Parent SKU, Component SKU, and Qty columns."
        cta="Import BOM"
      />

      <div className="card p-5">
        <form action="/manufacturing/bom" method="get" className="flex gap-2">
          <input
            name="sku"
            list="all-skus"
            defaultValue={sku ?? ""}
            placeholder="Find a finished product by SKU…"
            className="input"
          />
          <button className="btn btn-ghost" type="submit">
            Open
          </button>
        </form>
      </div>

      {sku && !parent && (
        <div className="card p-6 text-sm text-danger">No product “{sku}”.</div>
      )}

      {parent && (
        <div className="card overflow-hidden">
          <div className="p-4 border-b border-border">
            <div className="font-mono text-sm">{parent.sku}</div>
            <div className="text-muted text-sm">{parent.name}</div>
          </div>

          {parent.bomParentOf.length === 0 ? (
            <div className="p-6 text-center text-muted text-sm">
              No components yet.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-muted text-left">
                <tr className="border-b border-border">
                  <th className="px-4 py-2 font-medium">Component</th>
                  <th className="px-4 py-2 font-medium">Name</th>
                  <th className="px-4 py-2 font-medium text-right">Qty</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {parent.bomParentOf.map((c) => (
                  <tr key={c.id} className="border-b border-border/50">
                    <td className="px-4 py-2 font-mono text-xs">{c.component.sku}</td>
                    <td className="px-4 py-2">{c.component.name}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{c.qty}</td>
                    <td className="px-4 py-2 text-right">
                      <form action={removeBomComponent}>
                        <input type="hidden" name="id" value={c.id} />
                        <button
                          type="submit"
                          className="text-muted hover:text-danger text-xs"
                          aria-label="Remove component"
                        >
                          ✕
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <div className="p-4 border-t border-border">
            <form action={addBomComponent} className="flex flex-col sm:flex-row gap-2">
              <input type="hidden" name="productSku" value={parent.sku} />
              <input
                name="componentSku"
                list="all-skus"
                placeholder="Component SKU"
                required
                className="input"
              />
              <input
                name="qty"
                type="number"
                min={1}
                defaultValue={1}
                className="input sm:max-w-[100px]"
                aria-label="Quantity"
              />
              <button className="btn btn-primary whitespace-nowrap" type="submit">
                Add component
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
