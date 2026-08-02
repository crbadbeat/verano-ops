import { moneyFloor, moneyCompact } from "@/lib/reporting/format";
import type { LeaderCard } from "@/lib/reporting/shows";
import { GoalRing, MiniStat, RankedShows } from "./dashboard-ui";
import RepAvatar from "@/components/employees/RepAvatar";

/**
 * One show leader's performance across a date range: identity + a radial goal
 * meter on the left, their range stats and a per-show breakdown on the right.
 * Leaders are the headline unit on the Analytics page — they carry the goals
 * that drive end-of-year rewards. Server-rendered, no client JS.
 */
export default function LeaderStatCard({ l }: { l: LeaderCard }) {
  return (
    <div className="card overflow-hidden">
      <div className="grid lg:grid-cols-[minmax(0,300px)_minmax(0,1fr)]">
        {/* LEFT — leader identity + goal meter */}
        <div className="p-5 space-y-4 bg-surface-2/20 border-b lg:border-b-0 lg:border-r border-border">
          <div className="flex items-center gap-3">
            <RepAvatar id={l.leaderId === "__none__" ? null : l.leaderId} name={l.leaderName} size={44} />
            <div className="space-y-0.5 min-w-0">
              <div className="font-semibold leading-tight text-lg truncate">{l.leaderName}</div>
              <div className="text-xs text-muted">
                {l.showCount} {l.showCount === 1 ? "show" : "shows"} led · {l.count} {l.count === 1 ? "order" : "orders"}
              </div>
            </div>
          </div>

          <GoalRing pct={l.pctToGoal} salesCents={l.salesCents} goalCents={l.goalCents || null} />
        </div>

        {/* RIGHT — stats + per-show detail */}
        <div className="p-5 space-y-5">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            <MiniStat label="Sales" value={moneyFloor(l.salesCents)} tone="teal" />
            <MiniStat label="Goal" value={l.goalCents ? moneyCompact(l.goalCents) : "—"} tone="ember" />
            <MiniStat label="Orders" value={l.count.toLocaleString()} />
            <MiniStat label="Avg order" value={moneyCompact(l.aovCents)} />
          </div>

          {l.shows.length > 0 ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-mono uppercase tracking-widest text-muted">Show details</h3>
                <span className="text-xs text-muted tabular-nums">{l.showCount} {l.showCount === 1 ? "show" : "shows"}</span>
              </div>
              <RankedShows shows={l.shows} />
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted">
              No shows in this range.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
