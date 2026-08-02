import { requireDashboardUser, dashboardTabs, resolveSiteScope } from "@/lib/reporting/scope";
import { getNetworkMetrics } from "@/lib/reporting/network";
import DashboardChrome from "@/components/dashboard/DashboardChrome";
import KpiTile from "@/components/dashboard/KpiTile";
import Leaderboard, { type LeaderRow } from "@/components/dashboard/Leaderboard";

export const dynamic = "force-dynamic";

export default async function NetworkDashboard({
  searchParams,
}: {
  searchParams: Promise<{ site?: string }>;
}) {
  const user = await requireDashboardUser();
  await searchParams;
  const scope = await resolveSiteScope("all");
  const metrics = await getNetworkMetrics();

  const stockedSites = metrics.perWarehouse.filter((w) => w.units !== 0).length;
  const warehouseRows: LeaderRow[] = metrics.perWarehouse.map((w) => ({
    key: w.id,
    name: w.isDefault ? `${w.name} · default` : w.name,
    value: w.units,
    valueLabel: w.units.toLocaleString("en-US"),
  }));
  const destRows: LeaderRow[] = metrics.inTransitByDest.map((d) => ({
    key: d.id,
    name: d.name,
    value: d.units,
    valueLabel: d.units.toLocaleString("en-US"),
  }));
  const maxPipeline = Math.max(1, ...metrics.pipeline.map((s) => s.count));

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 space-y-8">
      <DashboardChrome
        title="Network"
        description="Cross-site inventory balance, in-transit exposure, and the transfer pipeline."
        scope={scope}
        tabs={dashboardTabs(user)}
        showSite={false}
      />

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
        <KpiTile label="Network units" value={metrics.networkUnits.toLocaleString("en-US")} sub="incl. in-transit" />
        <KpiTile label="Sites stocked" value={stockedSites} sub={`of ${metrics.perWarehouse.length}`} />
        <KpiTile
          label="In-transit units"
          value={metrics.inTransitUnits.toLocaleString("en-US")}
          tone={metrics.inTransitUnits > 0 ? "ember" : "default"}
        />
        <KpiTile label="In-transit loads" value={metrics.inTransitCount} />
        <KpiTile
          label="Staged, not departed"
          value={metrics.transfersStaged}
          tone={metrics.transfersStaged > 0 ? "ember" : "default"}
        />
        <KpiTile
          label="Transfer cycle"
          value={metrics.transferCycleDays == null ? "—" : `${metrics.transferCycleDays}d`}
          sub="depart → receive, avg"
        />
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <section className="card overflow-hidden">
          <div className="p-4 border-b border-border flex items-center gap-3">
            <h2 className="font-semibold">On-hand by warehouse</h2>
            <span className="badge text-muted">{metrics.perWarehouse.length}</span>
          </div>
          <Leaderboard rows={warehouseRows} unit="u" emptyMessage="No warehouses with stock." />
        </section>

        <section className="card overflow-hidden">
          <div className="p-4 border-b border-border">
            <h2 className="font-semibold">In-transit by destination</h2>
          </div>
          <Leaderboard rows={destRows} unit="u" emptyMessage="Nothing in transit." />
        </section>
      </div>

      <section className="card overflow-hidden">
        <div className="p-4 border-b border-border">
          <h2 className="font-semibold">Transfer pipeline</h2>
        </div>
        <ul className="p-4 space-y-3">
          {metrics.pipeline.map((stage) => (
            <li key={stage.status} className="flex items-center gap-3">
              <span className="text-xs text-muted w-24 shrink-0">{stage.status}</span>
              <div className="flex-1 h-2 rounded-full bg-surface-2 overflow-hidden">
                <div
                  className="h-full rounded-full bg-teal"
                  style={{ width: `${Math.round((stage.count / maxPipeline) * 100)}%` }}
                />
              </div>
              <span className="text-sm font-semibold tabular-nums w-10 text-right">{stage.count}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
