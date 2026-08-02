import Link from "next/link";
import { moneyFloor, moneyCompact, pctFloor } from "@/lib/reporting/format";
import type { ShowStat, ShowPace } from "@/lib/reporting/shows";
import { GoalRing, MiniStat, Pill, RankedReps, StatusPill } from "./dashboard-ui";
import ShowSalesModal from "./ShowSalesModal";

/** Day X of N + linear end-of-show projection vs goal (live board only). */
function PaceRow({ pace }: { pace: ShowPace }) {
  const started = pace.dayIndex > 0;
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-xs text-muted">
      <span className="tabular-nums">Day {Math.max(pace.dayIndex, 0)} of {pace.totalDays}</span>
      {started && pace.projectedCents != null ? (
        <>
          <span aria-hidden>·</span>
          <span>
            proj <span className="font-semibold text-foreground tabular-nums">{moneyFloor(pace.projectedCents)}</span>
          </span>
          {pace.onTrack != null && (
            <Pill tone={pace.onTrack ? "success" : "ember"}>{pace.onTrack ? "On track" : "Behind"}</Pill>
          )}
        </>
      ) : (
        <>
          <span aria-hidden>·</span>
          <span>not started yet</span>
        </>
      )}
    </div>
  );
}

/**
 * One show's performance as a two-panel card: identity + radial goal meter on the
 * left, the order/rep detail on the right. Server-rendered; the per-sale detail
 * opens in a modal (ShowSalesModal — the card's only client island).
 */
export default function ShowStatCard({ s }: { s: ShowStat }) {
  const location = [s.city, s.state].filter(Boolean).join(", ");
  return (
    <div className="card overflow-hidden">
      <div className="grid lg:grid-cols-[minmax(0,300px)_minmax(0,1fr)]">
        {/* LEFT — identity + goal meter */}
        <div className="p-5 space-y-4 bg-surface-2/20 border-b lg:border-b-0 lg:border-r border-border">
          <div className="space-y-1.5">
            <div className="flex items-start gap-2">
              <Link
                href={`/events/${s.showId}`}
                className="font-semibold leading-tight hover:text-ember hover:underline min-w-0"
              >
                {s.name}
              </Link>
              <span className="ml-auto shrink-0">
                <StatusPill status={s.status} />
              </span>
            </div>
            <div className="text-xs text-muted">
              {s.dateSpan}
              {location && ` · ${location}`}
              {s.weather && (
                <span className="ml-1.5 whitespace-nowrap" title={s.weather.label}>
                  · {s.weather.emoji} {s.weather.tempF}°
                </span>
              )}
            </div>
            {s.leaderName && <div className="text-xs text-muted">Leader · {s.leaderName}</div>}
          </div>

          <GoalRing pct={s.pctToGoal} salesCents={s.salesCents} goalCents={s.goalCents} />

          {s.pace && <PaceRow pace={s.pace} />}
        </div>

        {/* RIGHT — orders + rep leaderboard */}
        <div className="p-5 space-y-5">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            <MiniStat label="Orders" value={s.count.toLocaleString()} />
            <MiniStat label="Avg order" value={moneyCompact(s.aovCents)} />
            <MiniStat label="Reps" value={s.reps.length.toLocaleString()} />
            <MiniStat label="Goal" value={s.goalCents ? moneyCompact(s.goalCents) : "—"} tone="ember" />
          </div>

          {s.reps.length > 0 ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-mono uppercase tracking-widest text-muted">Rep leaderboard</h3>
                <span className="text-xs text-muted tabular-nums">{s.reps.length} selling</span>
              </div>
              <RankedReps reps={s.reps} />
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted">
              No sales logged yet.
            </div>
          )}

          {s.sales.length > 0 && <ShowSalesModal sales={s.sales} showName={s.name} />}
        </div>
      </div>
    </div>
  );
}
