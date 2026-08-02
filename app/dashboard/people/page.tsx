import { requireDashboardUser, dashboardTabs, resolveSiteScope } from "@/lib/reporting/scope";
import { parseRange } from "@/lib/reporting/range";
import { getPeopleMetrics, type PersonRow } from "@/lib/reporting/people";
import { money } from "@/lib/reporting/format";
import DashboardChrome from "@/components/dashboard/DashboardChrome";
import DataTable, { type Column } from "@/components/ui/DataTable";
import Leaderboard, { type LeaderRow } from "@/components/dashboard/Leaderboard";

export const dynamic = "force-dynamic";

const num = (n: number) => <span className="tabular-nums">{n}</span>;

const PEOPLE_COLUMNS: Column<PersonRow>[] = [
  { key: "name", header: "Person", cell: (p) => <span className="font-medium">{p.name}</span> },
  { key: "picks", header: "Units picked", align: "right", cell: (p) => num(p.picks) },
  { key: "counts", header: "Counts", align: "right", cell: (p) => num(p.counts) },
  { key: "glass", header: "Glass cuts", align: "right", cell: (p) => num(p.glassCuts) },
  { key: "returns", header: "Returns closed", align: "right", cell: (p) => num(p.returnsClosed) },
  { key: "trips", header: "Trips staged", align: "right", cell: (p) => num(p.tripsStaged) },
  { key: "mfg", header: "Mfg entries", align: "right", cell: (p) => num(p.mfgRecorded) },
];

export default async function PeopleDashboard({
  searchParams,
}: {
  searchParams: Promise<{ preset?: string; from?: string; to?: string }>;
}) {
  const user = await requireDashboardUser();
  const sp = await searchParams;
  const now = new Date();
  const range = parseRange(sp, now);
  const scope = await resolveSiteScope("all");
  const { people, payroll } = await getPeopleMetrics(range);

  const payRows: LeaderRow[] = payroll.map((p) => ({
    key: p.id,
    name: p.name,
    value: p.cents,
    valueLabel: money(p.cents),
  }));

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 space-y-8">
      <DashboardChrome
        title="People"
        description="Who did the work, across every department — for coaching and accountability."
        range={range}
        scope={scope}
        tabs={dashboardTabs(user)}
        showSite={false}
      />

      <section className="card overflow-hidden">
        <div className="p-4 border-b border-border flex items-center gap-3">
          <h2 className="font-semibold">App users — floor activity</h2>
          <span className="badge text-muted">{people.length}</span>
        </div>
        <DataTable
          columns={PEOPLE_COLUMNS}
          rows={people}
          rowKey={(p) => p.id}
          emptyMessage="No attributed activity in this window."
        />
      </section>

      <section className="card overflow-hidden">
        <div className="p-4 border-b border-border flex items-center gap-3">
          <h2 className="font-semibold">Shop-floor payroll — bonus earned</h2>
          <span className="badge text-muted">{payroll.length}</span>
        </div>
        <Leaderboard rows={payRows} emptyMessage="No bonus-bearing manufacturing in this window." />
      </section>

      <p className="text-xs text-muted">
        These are three separate identity systems — app users, payroll employees, and free-text
        sales/driver names — shown side by side, not merged. A manufacturing worker is a payroll
        employee, not a login, so bonus payout is tracked separately from user activity.
      </p>
    </div>
  );
}
