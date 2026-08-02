import Link from "next/link";
import { getViewer } from "@/lib/permissions/engine";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { can } from "@/lib/rbac";
import { getSalesEntryFormData } from "@/lib/sales-entry-data";
import { updateSalesEntry, deleteSalesEntry } from "@/app/sales-entry/actions";
import PageHeader from "@/components/ui/PageHeader";
import SalesEntryForm, { type SalesEntryInitial } from "@/components/sales-entry/SalesEntryForm";

export const dynamic = "force-dynamic";

export default async function EditSalesEntryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getViewer();
  if (!user) redirect("/login");
  if (!can(user, "salesentry:edit")) redirect("/");

  const { id } = await params;
  const entry = await prisma.salesEntry.findUnique({ where: { id } });
  if (!entry) notFound();

  // Reps may only edit their own entries; managers/admins may edit any.
  const isOwner = entry.enteredById === user.id;
  if (!isOwner && !can(user, "salesentry:manage_all")) redirect("/sales-entry");

  const { shows, employees, priceLists } = await getSalesEntryFormData({
    includeShowId: entry.showEventId,
  });
  const canEditDate = can(user, "salesentry:manage_all");

  const initial: SalesEntryInitial = {
    id: entry.id,
    showEventId: entry.showEventId,
    showLeaderId: entry.showLeaderId,
    salesRepId: entry.salesRepId,
    isSplitDeal: entry.isSplitDeal,
    secondSalesRepId: entry.secondSalesRepId,
    customerFirst: entry.customerFirst,
    customerLast: entry.customerLast,
    dealType: entry.dealType,
    saleType: entry.saleType,
    priceList: entry.priceList,
    grillIsland: entry.grillIsland,
    islandBar: entry.islandBar,
    additionalIsland: entry.additionalIsland,
    shadesOfVerano: entry.shadesOfVerano,
    productTotalCents: entry.productTotalCents,
    pflFeeCents: entry.pflFeeCents,
    soldAt: entry.soldAt ? entry.soldAt.toISOString().slice(0, 10) : null,
  };

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 space-y-6">
      <PageHeader
        eyebrow="PGI Sales"
        title="Edit sales entry"
        description={`${entry.customerFirst} ${entry.customerLast}`}
        actions={
          <Link href="/sales-entry" className="btn btn-ghost text-sm">
            Back
          </Link>
        }
      />
      <div className="card p-6">
        <SalesEntryForm
          shows={shows}
          employees={employees}
          priceLists={priceLists}
          action={updateSalesEntry}
          submitLabel="Save changes"
          initial={initial}
          canEditDate={canEditDate}
        />
      </div>

      <form action={deleteSalesEntry} className="flex justify-end">
        <input type="hidden" name="id" value={entry.id} />
        <button className="btn btn-ghost text-sm text-danger">Delete entry</button>
      </form>
    </div>
  );
}
