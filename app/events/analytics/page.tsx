import { notFound } from "next/navigation";
import { getViewer } from "@/lib/permissions/engine";
import { can } from "@/lib/rbac";
import { parseRange, presetRange } from "@/lib/reporting/range";
import { getShowAnalytics } from "@/lib/reporting/shows";
import { moneyFloor, moneyCompact, pctFloor } from "@/lib/reporting/format";
import PageHeader from "@/components/ui/PageHeader";
import EventsTabs from "@/components/events/EventsTabs";
import EventsRangeControl from "@/components/events/EventsRangeControl";
import AnalyticsViewToggle from "@/components/events/AnalyticsViewToggle";
import ShowStatCard from "@/components/events/ShowStatCard";
import LeaderStatCard from "@/components/events/LeaderStatCard";
import { StatTile, MiniGoalRing } from "@/components/events/dashboard-ui";
import EmptyState from "@/components/ui/EmptyState";

export const dynamic = "force-dynamic";

function nowDate(): Date {
  return new Date();
}

export default async function ShowAnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ preset?: string; from?: string; to?: string; view?: string }>;
}) {
  const me = await getViewer();
  if (!can(me, "events:view")) notFound();

  const sp = await searchParams;
  const now = nowDate();
  const range = sp.from || sp.to || sp.preset ? parseRange(sp, now) : presetRange("mtd", now);
  const view = sp.view === "shows" ? "shows" : "leaders"; // leaders is the default
  const { shows, leaderCards, totals } = await getShowAnalytics(range);

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 space-y-6">
      <PageHeader
        eyebrow="PGI"
        title="Show analytics"
        description="Self-reported PGI sales over a date range — led by the show leaders whose goals drive year-end rewards."
        actions={<EventsRangeControl current={range.preset} from={range.fromIso} to={range.toIso} />}
      />
      <EventsTabs />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <AnalyticsViewToggle current={view} />
        <p className="text-xs text-muted">
          {range.label} · {range.fromIso} → {range.toIso}
        </p>
      </div>

      {totals.count === 0 && leaderCards.length === 0 ? (
        <EmptyState message="No shows or sales in this range." />
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            <StatTile label="Total sales" value={moneyFloor(totals.salesCents)} tone="teal" />
            <StatTile label="Combined goal" value={moneyFloor(totals.goalCents)} tone="ember" sub={`${pctFloor(totals.pctToGoal)} to goal`} />
            <StatTile label="Leaders" value={totals.leaderCount.toLocaleString()} sub={`${totals.showCount} shows`} />
            <StatTile label="Orders" value={totals.count.toLocaleString()} />
            <StatTile label="Avg order" value={moneyCompact(totals.aovCents)} />
          </div>

          {view === "leaders" ? (
            /* LEADERS — the headline view: one card per leader, their shows inside */
            <div className="space-y-4">
              <h2 className="text-sm font-mono uppercase tracking-widest text-muted">
                {leaderCards.length} {leaderCards.length === 1 ? "leader" : "leaders"} · sorted by % to goal
              </h2>
              {leaderCards.map((l) => (
                <LeaderStatCard key={l.leaderId} l={l} />
              ))}
            </div>
          ) : (
            /* SHOWS — the show cards, with a leaders scoreboard on top */
            <>
              {leaderCards.length > 0 && (
                <div className="card p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <h2 className="text-sm font-mono uppercase tracking-widest text-muted">Leaders</h2>
                    <span className="text-xs text-muted">sorted by % to goal</span>
                  </div>
                  <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-3">
                    {leaderCards.map((l) => (
                      <MiniGoalRing
                        key={l.leaderId}
                        label={l.leaderName}
                        pct={l.pctToGoal}
                        salesCents={l.salesCents}
                        onTrack={null}
                      />
                    ))}
                  </div>
                </div>
              )}

              {shows.length > 0 ? (
                <div className="space-y-4">
                  <h2 className="text-sm font-mono uppercase tracking-widest text-muted">
                    {shows.length} {shows.length === 1 ? "show" : "shows"} with sales
                  </h2>
                  {shows.map((s) => (
                    <ShowStatCard key={s.showId} s={s} />
                  ))}
                </div>
              ) : (
                <EmptyState message="No sales logged in this range yet." />
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
