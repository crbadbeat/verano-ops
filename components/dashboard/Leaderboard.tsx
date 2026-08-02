import type { ReactNode } from "react";
import EmptyState from "@/components/ui/EmptyState";

export type LeaderRow = {
  key: string;
  name: ReactNode;
  value: number;
  valueLabel?: ReactNode;
  meta?: ReactNode;
};

/**
 * A ranked list with an inline magnitude bar per row (a horizontal bar chart in
 * table clothing). Bars share one scale so lengths compare directly; the number
 * is the source of truth and the bar is the at-a-glance encoding.
 */
export default function Leaderboard({
  rows,
  unit,
  emptyMessage = "No activity in range.",
  max,
}: {
  rows: LeaderRow[];
  unit?: string;
  emptyMessage?: ReactNode;
  max?: number;
}) {
  if (rows.length === 0) return <EmptyState message={emptyMessage} />;
  const top = max ?? Math.max(1, ...rows.map((r) => r.value));

  return (
    <ol className="divide-y divide-border/60">
      {rows.map((row, i) => (
        <li key={row.key} className="flex items-center gap-3 px-4 py-2.5">
          <span className="text-xs text-muted tabular-nums w-5 text-right shrink-0">{i + 1}</span>
          <div className="min-w-0 flex-1">
            <div className="text-sm truncate">{row.name}</div>
            <div className="mt-1 h-1.5 rounded-full bg-surface-2 overflow-hidden">
              <div
                className="h-full rounded-full bg-ember"
                style={{ width: `${Math.max(2, Math.round((row.value / top) * 100))}%` }}
              />
            </div>
          </div>
          <div className="text-right shrink-0">
            <div className="text-sm font-semibold tabular-nums">
              {row.valueLabel ?? row.value}
              {unit ? <span className="text-xs text-muted font-normal"> {unit}</span> : null}
            </div>
            {row.meta != null && <div className="text-xs text-muted">{row.meta}</div>}
          </div>
        </li>
      ))}
    </ol>
  );
}
