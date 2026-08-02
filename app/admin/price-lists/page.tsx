import Link from "next/link";
import { getViewer } from "@/lib/permissions/engine";
import { notFound } from "next/navigation";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import PageHeader from "@/components/ui/PageHeader";
import StatusChip from "@/components/ui/StatusChip";
import ToastOnParam from "@/components/ui/ToastOnParam";
import { createPriceList, updatePriceList, deletePriceList } from "./actions";

export const dynamic = "force-dynamic";

export default async function PriceListsPage() {
  const me = await getViewer();
  if (!can(me, "admin.pricelists:edit")) notFound();

  const priceLists = await prisma.priceList.findMany({
    orderBy: [{ active: "desc" }, { sortOrder: "asc" }, { name: "asc" }],
  });

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 space-y-8">
      <ToastOnParam map={{ saved: "Price list saved", deleted: "Price list deleted" }} />
      <Link href="/admin" className="text-muted hover:text-foreground text-sm">
        ← Admin
      </Link>

      <PageHeader
        eyebrow="Admin"
        title="Price lists"
        description="The Price List options offered on the sales-entry form. Deactivate one to hide it from new entries without affecting past entries."
      />

      {/* Create */}
      <form action={createPriceList} className="card p-4 flex items-end gap-3 flex-wrap">
        <label className="text-sm flex-1 min-w-[12rem]">
          <span className="text-muted">New price list</span>
          <input name="name" required className="input mt-1" placeholder="e.g. Money Maker" />
        </label>
        <label className="text-sm w-28">
          <span className="text-muted">Abbrev.</span>
          <input name="abbreviation" className="input mt-1" placeholder="e.g. MM" />
        </label>
        <label className="text-sm w-24">
          <span className="text-muted">Order</span>
          <input name="sortOrder" type="number" defaultValue={0} className="input mt-1" />
        </label>
        <button className="btn btn-primary text-sm">Add</button>
      </form>

      <div className="space-y-2">
        <h2 className="text-sm font-mono uppercase tracking-widest text-muted">
          {priceLists.length} price list{priceLists.length === 1 ? "" : "s"}
        </h2>

        {priceLists.map((pl) => (
          <div key={pl.id} className="card p-4">
            <div className="flex items-center gap-3 flex-wrap">
              <span className="font-semibold">{pl.name}</span>
              {pl.abbreviation && <span className="badge text-teal">{pl.abbreviation}</span>}
              {!pl.active && <StatusChip label="Inactive" tone="danger" />}
              <span className="text-xs text-muted">order {pl.sortOrder}</span>
            </div>

            <details className="group mt-2">
              <summary className="cursor-pointer text-sm text-teal hover:underline">Edit</summary>
              <div className="mt-3 flex items-end gap-3 flex-wrap">
                <form action={updatePriceList} className="flex items-end gap-3 flex-wrap">
                  <input type="hidden" name="id" value={pl.id} />
                  <label className="text-sm flex-1 min-w-[10rem]">
                    <span className="text-muted">Name</span>
                    <input name="name" defaultValue={pl.name} required className="input mt-1" />
                  </label>
                  <label className="text-sm w-24">
                    <span className="text-muted">Abbrev.</span>
                    <input name="abbreviation" defaultValue={pl.abbreviation ?? ""} className="input mt-1" />
                  </label>
                  <label className="text-sm w-20">
                    <span className="text-muted">Order</span>
                    <input name="sortOrder" type="number" defaultValue={pl.sortOrder} className="input mt-1" />
                  </label>
                  <label className="flex items-center gap-2 text-sm pb-2">
                    <input type="checkbox" name="active" defaultChecked={pl.active} />
                    <span>Active</span>
                  </label>
                  <button className="btn btn-ghost text-sm">Save</button>
                </form>
                <form action={deletePriceList}>
                  <input type="hidden" name="id" value={pl.id} />
                  <button className="btn btn-ghost text-sm text-danger">Delete</button>
                </form>
              </div>
            </details>
          </div>
        ))}

        {priceLists.length === 0 && (
          <div className="card p-8 text-center text-muted text-sm">
            No price lists yet. Add one above — they appear in the sales-entry Price List dropdown.
          </div>
        )}
      </div>
    </div>
  );
}
