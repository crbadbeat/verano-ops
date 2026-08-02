import Link from "next/link";
import { getViewer } from "@/lib/permissions/engine";
import { redirect } from "next/navigation";
import { can } from "@/lib/rbac";
import { getSalesEntryFormData } from "@/lib/sales-entry-data";
import { createSalesEntry } from "@/app/sales-entry/actions";
import PageHeader from "@/components/ui/PageHeader";
import SalesEntryForm from "@/components/sales-entry/SalesEntryForm";

export const dynamic = "force-dynamic";

export default async function NewSalesEntryPage() {
  const user = await getViewer();
  if (!user) redirect("/login");
  if (!can(user, "salesentry:edit")) redirect("/");

  const { shows, employees, priceLists } = await getSalesEntryFormData();

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 space-y-6">
      <PageHeader
        eyebrow="PGI Sales"
        title="Log a sale"
        description="Record a completed PGI show sale for the leaderboard."
        actions={
          <Link href="/sales-entry" className="btn btn-ghost text-sm">
            My entries
          </Link>
        }
      />
      <div className="card p-6">
        <SalesEntryForm
          shows={shows}
          employees={employees}
          priceLists={priceLists}
          action={createSalesEntry}
          submitLabel="Submit"
        />
      </div>
    </div>
  );
}
