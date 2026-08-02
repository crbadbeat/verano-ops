import { notFound } from "next/navigation";
import { getViewer } from "@/lib/permissions/engine";
import { can } from "@/lib/rbac";
import { getActiveShows, type RepStat } from "@/lib/reporting/shows";
import { moneyFloor, moneyCompact, pctFloor } from "@/lib/reporting/format";
import PageHeader from "@/components/ui/PageHeader";
import EventsTabs from "@/components/events/EventsTabs";
import ShowStatCard from "@/components/events/ShowStatCard";
import AutoRefresh from "@/components/events/AutoRefresh";
import { StatTile, RankedReps, MiniGoalRing } from "@/components/events/dashboard-ui";
import EmptyState from "@/components/ui/EmptyState";

export const dynamic = "force-dynamic";

// Clock read kept out of the component render (server components stay pure).
function nowDate(): Date {
  return new Date();
}

export default async function ActiveShowsPage() {
  const me = await getViewer();
  if (!can(me, "events:view")) notFound();

  const { shows, totals } = await getActiveShows(nowDate());

  // Cross-show rep leaderboard ("who's hot right now").
  const repMap = new Map<string, RepStat>();
  for (const s of shows) {
    for (const r of s.reps) {
      const cur = repMap.get(r.repId) ?? { repId: r.repId, repName: r.repName, count: 0, salesCents: 0, aovCents: 0 };
      cur.count += r.count;
      cur.salesCents += r.salesCents;
      repMap.set(r.repId, cur);
    }
  }
  const topReps = [...repMap.values()]
    .map((r) => ({ ...r, aovCents: r.count ? Math.round(r.salesCents / r.count) : 0 }))
    .sort((a, b) => b.salesCents - a.salesCents);

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 space-y-6">
      <PageHeader
        eyebrow="PGI"
        title="Active shows"
        description="Shows running right now — self-reported sales updating live through the cycle."
        actions={<AutoRefresh seconds={60} />}
      />
      <EventsTabs />

      {shows.length === 0 ? (
        <EmptyState message="No shows are active right now. Check the calendar for what's coming up." />
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            <StatTile label="Active shows" value={totals.showCount.toLocaleString()} />
            <StatTile label="Sales so far" value={moneyFloor(totals.salesCents)} tone="teal" />
            <StatTile label="Combined goal" value={moneyFloor(totals.goalCents)} tone="ember" sub={`${pctFloor(totals.pctToGoal)} to goal`} />
            <StatTile label="Orders" value={totals.count.toLocaleString()} sub={`${totals.repCount} reps selling`} />
            <StatTile label="Avg order" value={moneyCompact(totals.aovCents)} />
          </div>

          {/* Scoreboard — one goal ring per show, highest %-to-goal first */}
          <div className="card p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-mono uppercase tracking-widest text-muted">Scoreboard</h2>
              <span className="text-xs text-muted">sorted by % to goal</span>
            </div>
            <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-3">
              {shows.map((s) => (
                <MiniGoalRing
                  key={s.showId}
                  href={`/events/${s.showId}`}
                  label={s.shortName?.trim() || s.name}
                  pct={s.pctToGoal}
                  salesCents={s.salesCents}
                  onTrack={s.pace?.onTrack ?? null}
                />
              ))}
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,320px)]">
            {/* Show cards */}
            <div className="space-y-4">
              <h2 className="text-sm font-mono uppercase tracking-widest text-muted">
                {shows.length} active {shows.length === 1 ? "show" : "shows"}
              </h2>
              {shows.map((s) => (
                <ShowStatCard key={s.showId} s={s} />
              ))}
            </div>

            {/* Cross-show hot reps rail — card top aligns with the first show card
                via an invisible spacer that matches the "N active shows" label. */}
            {topReps.length > 0 && (
              <aside className="space-y-4">
                <div aria-hidden className="invisible select-none text-sm font-mono uppercase tracking-widest">
                  spacer
                </div>
                <div className="card p-5 lg:sticky lg:top-4 space-y-4">
                  <div className="flex items-center justify-between">
                    <h2 className="font-semibold">🔥 Hot right now</h2>
                    <span className="text-xs text-muted">{topReps.length} {topReps.length === 1 ? "rep" : "reps"}</span>
                  </div>
                  <RankedReps reps={topReps} />
                </div>
              </aside>
            )}
          </div>
        </>
      )}
    </div>
  );
}
