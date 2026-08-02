import { notFound } from "next/navigation";
import { getViewer } from "@/lib/permissions/engine";
import { can } from "@/lib/rbac";
import { getOverheadBps, getMinDepositBps } from "@/lib/settings";
import { bpsToPercentString } from "@/lib/overhead";
import { depositPctString } from "@/lib/deposit";
import PageHeader from "@/components/ui/PageHeader";
import OverheadForm from "@/components/admin/OverheadForm";
import MinDepositForm from "@/components/admin/MinDepositForm";

export const dynamic = "force-dynamic";

/**
 * Admin › Settings. Hub-wide configuration. Today: the landed-cost overhead %
 * added to average cost for inventory valuation. MANAGER/ADMIN (catalog.manage).
 */
export default async function AdminSettingsPage() {
  const user = await getViewer();
  if (!can(user, "admin.settings:view")) notFound();
  const canEdit = can(user, "admin.settings:edit");

  const bps = await getOverheadBps();
  const depositBps = await getMinDepositBps();

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 space-y-8">
      <PageHeader eyebrow="Admin" title="Settings" description="Hub-wide configuration." />

      <div className="card p-5 space-y-4">
        <div>
          <h2 className="font-semibold">Landed-cost overhead</h2>
          <p className="text-sm text-muted mt-1">
            A percentage added to each item&apos;s NetSuite average (landed) cost to
            cover overhead, used everywhere inventory value is shown — the Stock
            page, item detail, the inventory dashboard, and the CSV export.
            Warehouses marked <span className="text-foreground">overhead-exempt</span>{" "}
            (e.g. a supplier location holding pre-overhead cost) use the raw average
            instead; toggle that on{" "}
            <a href="/admin/locations" className="underline hover:text-ember">
              Locations &amp; bins
            </a>
            .
          </p>
        </div>
        {canEdit && <OverheadForm currentPct={bpsToPercentString(bps)} />}
        <p className="text-xs text-muted">
          Currently <span className="text-foreground font-medium">{bpsToPercentString(bps)}%</span>.
          Changes apply immediately to every valuation.
        </p>
      </div>

      <div className="card p-5 space-y-4">
        <div>
          <h2 className="font-semibold">Minimum deposit to schedule</h2>
          <p className="text-sm text-muted mt-1">
            The share of an order&apos;s grand total (incl. tax &amp; freight) that must be
            received before a NetSuite-synced order is released to the scheduling team. Below
            this, the order stays out of scheduling until more is paid. Applies to
            NetSuite-sourced orders once deposits are synced.
          </p>
        </div>
        {canEdit && <MinDepositForm currentPct={depositPctString(depositBps)} />}
        <p className="text-xs text-muted">
          Currently <span className="text-foreground font-medium">{depositPctString(depositBps)}%</span> down required.
        </p>
      </div>
    </div>
  );
}
