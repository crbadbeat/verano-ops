import Link from "next/link";
import type { ReactNode } from "react";
import TrendStrip, { type TrendPoint, type TrendTone } from "./TrendStrip";

export type KpiTone = "default" | "ember" | "teal" | "danger" | "success";

const VALUE_CLASS: Record<KpiTone, string> = {
  default: "text-foreground",
  ember: "text-ember",
  teal: "text-teal",
  danger: "text-danger",
  success: "text-success",
};

/**
 * A dashboard metric tile. Supports an optional sparkline and an explicit
 * "needs data" state for KPIs that are not derivable yet (e.g. inventory value
 * before a cost field is populated) — so a metric with no source yet shows the
 * gap, not a hidden hole.
 */
export default function KpiTile({
  label,
  value,
  tone = "default",
  sub,
  href,
  trend,
  trendTone,
  blocked = false,
  blockedReason,
}: {
  label: ReactNode;
  value?: ReactNode;
  tone?: KpiTone;
  sub?: ReactNode;
  href?: string;
  trend?: TrendPoint[];
  trendTone?: TrendTone;
  blocked?: boolean;
  blockedReason?: string;
}) {
  const body = blocked ? (
    <>
      <div className="text-3xl font-bold text-muted">—</div>
      <div className="text-sm text-muted mt-1">{label}</div>
      <div className="mt-2">
        <span className="badge text-muted">needs data</span>
      </div>
      {blockedReason && <div className="text-xs text-muted mt-1">{blockedReason}</div>}
    </>
  ) : (
    <>
      <div className={`text-3xl font-bold tabular-nums ${VALUE_CLASS[tone]}`}>{value}</div>
      <div className="text-sm text-muted mt-1">{label}</div>
      {sub != null && <div className="text-xs text-muted mt-1">{sub}</div>}
      {trend && trend.length > 0 && (
        <div className="mt-3">
          <TrendStrip
            points={trend}
            tone={trendTone ?? (tone === "teal" ? "teal" : "ember")}
            height={34}
            ariaLabel={typeof label === "string" ? label : undefined}
          />
        </div>
      )}
    </>
  );

  if (href && !blocked) {
    return (
      <Link
        href={href}
        className="card p-5 block hover:border-ember/60 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-ember"
      >
        {body}
      </Link>
    );
  }
  return <div className="card p-5">{body}</div>;
}
