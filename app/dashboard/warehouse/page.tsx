import {
  requireDashboardUser,
  resolveSiteScope,
  dashboardTabs,
} from "@/lib/reporting/scope";
import { parseRange } from "@/lib/reporting/range";
import { getWarehouseMetrics, type WorkerRow } from "@/lib/reporting/warehouse";
import DashboardChrome from "@/components/dashboard/DashboardChrome";
import KpiTile from "@/components/dashboard/KpiTile";
import TrendStrip from "@/components/dashboard/TrendStrip";
import DataTable, { type Column } from "@/components/ui/DataTable";

export const dynamic = "force-dynamic";

const WORKER_COLUMNS: Column<WorkerRow>[] = [
  { key: "name", header: "Worker", cell: (w) => <span className="font-medium">{w.name}</span> },
  {
    key: "picked",
    header: "Units picked",
    align: "right",
    cell: (w) => <span className="tabular-nums">{w.pickedUnits}</span>,
  },
  {
    key: "counts",
    header: "Count entries",
    align: "right",
    cell: (w) => <span className="tabular-nums">{w.countEntries}</span>,
  },
];

export default async function WarehouseDashboard({
  searchParams,
}: {
  searchParams: Promise<{ preset?: string; from?: string; to?: string; site?: string }>;
}) {
  const user = await requireDashboardUser();
  const sp = await searchParams;
  const now = new Date();
  const range = parseRange(sp, now);
  const scope = await resolveSiteScope(sp.site);
  const metrics = await getWarehouseMetrics(range, scope, now);

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 space-y-8">
      <DashboardChrome
        title="Warehouse"
        description="Staging performance, inventory health, and floor throughput for the selected site."
        range={range}
        scope={scope}
        tabs={dashboardTabs(user)}
      />

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
        <KpiTile
          label="On-time to stage"
          value={metrics.onTimeToStagePct == null ? "—" : `${metrics.onTimeToStagePct}%`}
          tone={
            metrics.onTimeToStagePct != null && metrics.onTimeToStagePct >= 90 ? "teal" : "ember"
          }
          sub={`${metrics.stagedCount} trips staged`}
        />
        <KpiTile label="Trips staged" value={metrics.stagedCount} trend={metrics.stagedPerDay} />
        <KpiTile
          label="Staging cycle"
          value={metrics.stagingCycleHours == null ? "—" : `${metrics.stagingCycleHours}h`}
          sub="finalize → staged, avg"
        />
        <KpiTile
          label="At-risk trips"
          value={metrics.atRiskCount}
          tone={metrics.atRiskCount > 0 ? "danger" : "default"}
          sub="stage-by date passed"
        />
        <KpiTile
          label="Unscheduled backlog"
          value={metrics.unscheduledBacklog}
          tone={metrics.unscheduledBacklog > 0 ? "ember" : "default"}
          sub="confirmed, no trip"
          href="/scheduling"
        />
        <KpiTile
          label="Negative-on-hand slots"
          value={metrics.negativeSlots}
          tone={metrics.negativeSlots > 0 ? "danger" : "default"}
          sub="data-integrity exceptions"
        />
        <KpiTile
          label="Out-of-stock SKUs"
          value={metrics.outOfStock}
          tone={metrics.outOfStock > 0 ? "ember" : "default"}
          sub="at this site"
        />
        <KpiTile
          label="Inventory value"
          blocked
          blockedReason="Needs the NetSuite cost sync (Product.standardCostCents)"
        />
      </div>

      <section className="card p-5 space-y-3">
        <h2 className="font-semibold">Units staged per day</h2>
        <TrendStrip
          points={metrics.unitsStagedPerDay}
          tone="ember"
          height={64}
          ariaLabel="Units staged per day"
        />
      </section>

      <section className="card overflow-hidden">
        <div className="p-4 border-b border-border flex items-center gap-3">
          <h2 className="font-semibold">People — floor activity</h2>
          <span className="badge text-muted">{metrics.workers.length}</span>
        </div>
        <DataTable
          columns={WORKER_COLUMNS}
          rows={metrics.workers}
          rowKey={(w) => w.id}
          emptyMessage="No picks or counts recorded in this window."
        />
      </section>
    </div>
  );
}
