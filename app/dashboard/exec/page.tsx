import {
  requireDashboardUser,
  dashboardTabs,
  resolveSiteScope,
} from "@/lib/reporting/scope";
import { parseRange } from "@/lib/reporting/range";
import { getExecMetrics } from "@/lib/reporting/exec";
import { money } from "@/lib/reporting/format";
import { PAYMENT_METHOD_LABEL } from "@/lib/order-payments";
import DashboardChrome from "@/components/dashboard/DashboardChrome";
import KpiTile from "@/components/dashboard/KpiTile";
import Leaderboard, { type LeaderRow } from "@/components/dashboard/Leaderboard";

export const dynamic = "force-dynamic";

export default async function ExecDashboard({
  searchParams,
}: {
  searchParams: Promise<{ preset?: string; from?: string; to?: string }>;
}) {
  const user = await requireDashboardUser();
  const sp = await searchParams;
  const now = new Date();
  const range = parseRange(sp, now);
  const scope = await resolveSiteScope("all"); // exec is company-wide
  const metrics = await getExecMetrics(range);

  const paymentRows: LeaderRow[] = metrics.paymentMix.map((p) => ({
    key: p.method,
    name: PAYMENT_METHOD_LABEL[p.method],
    value: p.cents,
    valueLabel: money(p.cents),
  }));
  const maxPipeline = Math.max(1, ...metrics.pipeline.map((s) => s.count));

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 space-y-8">
      <DashboardChrome
        title="Executive"
        description="Bookings, cash, pipeline, production, and inventory position across the company."
        range={range}
        scope={scope}
        tabs={dashboardTabs(user)}
        showSite={false}
      />

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
        <KpiTile
          label="Bookings"
          value={money(metrics.bookingsCents)}
          tone="teal"
          sub={`${metrics.bookingsCount} orders`}
          trend={metrics.bookingsByDay}
          trendTone="teal"
        />
        <KpiTile
          label="Cash collected"
          value={money(metrics.cashCents)}
          sub={`${money(metrics.feeFreeCents)} fee-free`}
        />
        <KpiTile
          label="Outstanding AR"
          value={money(metrics.arCents)}
          tone={metrics.arCents > 0 ? "ember" : "default"}
          sub="booked − paid, open orders"
        />
        <KpiTile
          label="Units built"
          value={metrics.unitsBuilt}
          trend={metrics.unitsBuiltByDay}
          sub="finished at Wrapping"
        />
        <KpiTile label="On-hand units" value={metrics.onHandUnits} sub="network-wide" />
        <KpiTile
          label="Negative slots"
          value={metrics.negativeSlots}
          tone={metrics.negativeSlots > 0 ? "danger" : "default"}
          href="/dashboard/exceptions"
        />
        <KpiTile
          label="Fraud checks"
          value={metrics.fraudBacklog}
          tone={metrics.fraudBacklog > 0 ? "ember" : "default"}
          href="/dashboard/exceptions"
        />
        <KpiTile label="Verano For Life" value={metrics.pflCount} sub="memberships in range" />
        <KpiTile
          label="Inventory value"
          blocked
          blockedReason="Needs the NetSuite cost sync (Product.standardCostCents)"
        />
        <KpiTile
          label="On-time delivery"
          blocked
          blockedReason="Needs driver sign-off (DeliveryTrip.deliveredAt, Track B)"
        />
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <section className="card overflow-hidden">
          <div className="p-4 border-b border-border">
            <h2 className="font-semibold">Payment mix</h2>
          </div>
          <Leaderboard rows={paymentRows} emptyMessage="No payments in this window." />
        </section>

        <section className="card overflow-hidden">
          <div className="p-4 border-b border-border">
            <h2 className="font-semibold">Order pipeline</h2>
          </div>
          <ul className="p-4 space-y-3">
            {metrics.pipeline.map((stage) => (
              <li key={stage.status} className="flex items-center gap-3">
                <span className="text-xs text-muted w-24 shrink-0">{stage.status}</span>
                <div className="flex-1 h-2 rounded-full bg-surface-2 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-ember"
                    style={{ width: `${Math.round((stage.count / maxPipeline) * 100)}%` }}
                  />
                </div>
                <span className="text-sm font-semibold tabular-nums w-10 text-right">
                  {stage.count}
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
