import Link from "next/link";
import { getViewer } from "@/lib/permissions/engine";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { can } from "@/lib/rbac";
import { money } from "@/lib/reporting/format";
import { employeeName } from "@/lib/employees";
import PageHeader from "@/components/ui/PageHeader";
import EmptyState from "@/components/ui/EmptyState";
import ToastOnParam from "@/components/ui/ToastOnParam";

export const dynamic = "force-dynamic";

function fmtDate(d: Date | null): string {
  return d ? d.toISOString().slice(0, 10) : "—";
}

export default async function SalesEntriesPage() {
  const user = await getViewer();
  if (!user) redirect("/login");
  if (!can(user, "salesentry:edit")) redirect("/");

  const seeAll = can(user, "salesentry:manage_all");

  const entries = await prisma.salesEntry.findMany({
    where: { division: "PGI", ...(seeAll ? {} : { enteredById: user.id }) },
    orderBy: [{ soldAt: "desc" }, { createdAt: "desc" }],
    take: 200,
    select: {
      id: true,
      customerFirst: true,
      customerLast: true,
      productTotalCents: true,
      dealType: true,
      saleType: true,
      soldAt: true,
      isSplitDeal: true,
      salesRep: { select: { firstName: true, lastName: true, name: true, preferredName: true } },
      secondSalesRep: { select: { name: true, preferredName: true } },
      showEvent: { select: { name: true } },
      showLeader: { select: { name: true, preferredName: true } },
    },
  });

  const total = entries.reduce((s, e) => s + e.productTotalCents, 0);

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 space-y-6">
      <PageHeader
        eyebrow="PGI Sales"
        title={seeAll ? "PGI sales entries" : "My sales entries"}
        description={
          seeAll
            ? "Every self-reported PGI show sale. Managers can correct any entry."
            : "Your self-reported PGI show sales. You can edit your own entries."
        }
        actions={
          <Link href="/sales-entry/new" className="btn btn-primary text-sm">
            Log a sale
          </Link>
        }
      />

      <ToastOnParam map={{ created: "Sale logged", updated: "Entry updated" }} />

      {entries.length === 0 ? (
        <EmptyState message="No sales entries yet. Log your first sale." />
      ) : (
        <div className="card overflow-hidden">
          <div className="flex items-center justify-between p-4 border-b border-border">
            <span className="text-sm text-muted">{entries.length} entries</span>
            <span className="text-sm font-semibold tabular-nums">{money(total)}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-muted border-b border-border">
                <tr>
                  <th className="p-3 font-medium">Sold</th>
                  <th className="p-3 font-medium">Show</th>
                  {seeAll && <th className="p-3 font-medium">Rep</th>}
                  <th className="p-3 font-medium">Customer</th>
                  <th className="p-3 font-medium">Deal / Sale</th>
                  <th className="p-3 font-medium text-right">Product total</th>
                  <th className="p-3 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.id} className="border-b border-border/60">
                    <td className="p-3 tabular-nums whitespace-nowrap">{fmtDate(e.soldAt)}</td>
                    <td className="p-3">
                      {e.showEvent?.name ?? "—"}
                      {e.showLeader?.name && (
                        <span className="block text-xs text-muted">Leader: {employeeName(e.showLeader)}</span>
                      )}
                    </td>
                    {seeAll && (
                      <td className="p-3">
                        {employeeName(e.salesRep)}
                        {e.isSplitDeal && e.secondSalesRep?.name && (
                          <span className="block text-xs text-muted">+ {employeeName(e.secondSalesRep)}</span>
                        )}
                      </td>
                    )}
                    <td className="p-3">
                      {e.customerFirst} {e.customerLast}
                    </td>
                    <td className="p-3">
                      {e.dealType}
                      <span className="block text-xs text-muted">{e.saleType}</span>
                    </td>
                    <td className="p-3 text-right tabular-nums">{money(e.productTotalCents)}</td>
                    <td className="p-3 text-right">
                      <Link
                        href={`/sales-entry/${e.id}/edit`}
                        className="text-ember hover:underline"
                      >
                        Edit
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
