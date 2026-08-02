import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import {
  requireDepartmentUser,
  dashboardTabs,
  resolveSiteScope,
  isDeptKey,
  DEPARTMENTS,
  type DeptKey,
} from "@/lib/reporting/scope";
import { parseRange } from "@/lib/reporting/range";
import { money } from "@/lib/reporting/format";
import {
  getMfgMetrics,
  getGlassMetrics,
  getReturnsMetrics,
  getSalesMetrics,
} from "@/lib/reporting/department";
import DashboardChrome from "@/components/dashboard/DashboardChrome";
import KpiTile from "@/components/dashboard/KpiTile";
import Leaderboard from "@/components/dashboard/Leaderboard";

export const dynamic = "force-dynamic";

const DEPT_DESC: Record<DeptKey, string> = {
  mfg: "Build throughput, void/rework rate, and bonus payout.",
  glass: "Waterjet queue, on-time cuts, and operator throughput.",
  returns: "Return check-ins, outstanding units, and aging.",
  sales: "Bookings, qualifiers, and rep performance.",
};

function BarRow({ label, value, max }: { label: string; value: number; max: number }) {
  return (
    <li className="flex items-center gap-3">
      <span className="text-xs text-muted w-24 shrink-0">{label}</span>
      <div className="flex-1 h-2 rounded-full bg-surface-2 overflow-hidden">
        <div
          className="h-full rounded-full bg-ember"
          style={{ width: `${Math.round((value / max) * 100)}%` }}
        />
      </div>
      <span className="text-sm font-semibold tabular-nums w-10 text-right">{value}</span>
    </li>
  );
}

export default async function DepartmentDashboard({
  params,
  searchParams,
}: {
  params: Promise<{ dept: string }>;
  searchParams: Promise<{ preset?: string; from?: string; to?: string }>;
}) {
  const { dept } = await params;
  if (!isDeptKey(dept)) notFound();
  const user = await requireDepartmentUser(dept);
  const sp = await searchParams;
  const now = new Date();
  const range = parseRange(sp, now);
  const scope = await resolveSiteScope("all");
  const label = DEPARTMENTS.find((d) => d.key === dept)?.label ?? "Department";

  let content: ReactNode = null;

  if (dept === "mfg") {
    const m = await getMfgMetrics(range);
    const stageMax = Math.max(1, ...m.byStage.map((s) => s.count));
    content = (
      <>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <KpiTile label="Units built" value={m.unitsBuilt} sub="finished at Wrapping" />
          <KpiTile label="Jobs recorded" value={m.jobs} />
          <KpiTile label="Mods recorded" value={m.mods} />
          <KpiTile
            label="Void / rework"
            value={m.voidRate == null ? "—" : `${m.voidRate}%`}
            tone={(m.voidRate ?? 0) > 0 ? "ember" : "default"}
          />
        </div>
        <div className="grid md:grid-cols-2 gap-4">
          <section className="card overflow-hidden">
            <div className="p-4 border-b border-border">
              <h2 className="font-semibold">Throughput by stage</h2>
            </div>
            <ul className="p-4 space-y-3">
              {m.byStage.map((s) => (
                <BarRow key={s.stage} label={s.stage} value={s.count} max={stageMax} />
              ))}
            </ul>
          </section>
          <section className="card overflow-hidden">
            <div className="p-4 border-b border-border">
              <h2 className="font-semibold">Bonus by worker</h2>
            </div>
            <Leaderboard
              rows={m.bonusByWorker.map((w) => ({
                key: w.id,
                name: w.name,
                value: w.cents,
                valueLabel: money(w.cents),
              }))}
              emptyMessage="No bonus-bearing jobs in this window."
            />
          </section>
        </div>
      </>
    );
  } else if (dept === "glass") {
    const m = await getGlassMetrics(range, now);
    content = (
      <>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
          <KpiTile label="Queue depth" value={m.queueDepth} sub="queued + in progress" />
          <KpiTile label="Overdue cuts" value={m.overdue} tone={m.overdue > 0 ? "danger" : "default"} />
          <KpiTile label="Completed" value={m.completed} sub="in range" />
          <KpiTile
            label="On-time %"
            value={m.onTimePct == null ? "—" : `${m.onTimePct}%`}
            tone={m.onTimePct != null && m.onTimePct >= 90 ? "teal" : "ember"}
          />
          <KpiTile
            label="Cut cycle"
            value={m.cutCycleHours == null ? "—" : `${m.cutCycleHours}h`}
            sub="start → complete"
          />
        </div>
        <section className="card overflow-hidden">
          <div className="p-4 border-b border-border">
            <h2 className="font-semibold">Operator cuts</h2>
          </div>
          <Leaderboard
            rows={m.operatorScore.map((o) => ({ key: o.id, name: o.name, value: o.count, valueLabel: o.count }))}
            unit="cuts"
            emptyMessage="No completed cuts in this window."
          />
        </section>
      </>
    );
  } else if (dept === "returns") {
    const m = await getReturnsMetrics(range, now);
    content = (
      <>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <KpiTile label="Flagged returns" value={m.flaggedCount} tone={m.flaggedCount > 0 ? "ember" : "default"} />
          <KpiTile label="Outstanding units" value={m.outstandingUnits} sub="still to check in" />
          <KpiTile label="Closed" value={m.closedInWindow} sub="in range" />
          <KpiTile
            label="Avg aging"
            value={m.avgAgingDays == null ? "—" : `${m.avgAgingDays}d`}
            sub="flagged, still open"
            tone={(m.avgAgingDays ?? 0) > 14 ? "danger" : "default"}
          />
        </div>
        <section className="card overflow-hidden">
          <div className="p-4 border-b border-border">
            <h2 className="font-semibold">Closed by staff</h2>
          </div>
          <Leaderboard
            rows={m.closedByStaff.map((s) => ({ key: s.id, name: s.name, value: s.count, valueLabel: s.count }))}
            unit="returns"
            emptyMessage="No returns closed in this window."
          />
        </section>
      </>
    );
  } else {
    const m = await getSalesMetrics(range);
    content = (
      <>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
          <KpiTile label="Bookings" value={money(m.bookingsCents)} tone="teal" sub={`${m.bookingsCount} orders`} />
          <KpiTile label="Orders" value={m.bookingsCount} />
          <KpiTile label="Paid-in-full 1%" value={m.pif1Count} />
          <KpiTile label="Verano For Life" value={m.pflCount} />
          <KpiTile
            label="Fraud checks"
            value={m.fraudBacklog}
            tone={m.fraudBacklog > 0 ? "ember" : "default"}
            href="/orders?fraud=1"
          />
        </div>
        <section className="card overflow-hidden">
          <div className="p-4 border-b border-border">
            <h2 className="font-semibold">Bookings by rep</h2>
          </div>
          <Leaderboard
            rows={m.bookingsByRep.map((r, i) => ({
              key: `${r.name}-${i}`,
              name: r.name,
              value: r.cents,
              valueLabel: money(r.cents),
            }))}
            emptyMessage="No bookings in this window."
          />
        </section>
      </>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 space-y-8">
      <DashboardChrome
        title={label}
        description={DEPT_DESC[dept]}
        range={range}
        scope={scope}
        tabs={dashboardTabs(user)}
        showSite={false}
      />
      {content}
    </div>
  );
}
