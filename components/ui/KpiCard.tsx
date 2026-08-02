import Link from "next/link";
import type { ReactNode } from "react";

export type KpiAccent =
  | "default"
  | "ember"
  | "teal"
  | "danger"
  | "success"
  | "showgood";

const ACCENT_CLASS: Record<KpiAccent, string> = {
  default: "text-foreground",
  ember: "text-ember",
  teal: "text-teal",
  danger: "text-danger",
  success: "text-success",
  showgood: "text-showgood",
};

/**
 * A single headline metric. Optionally links somewhere (the whole card becomes
 * the target). Digits use tabular-nums so a row of tiles stays aligned.
 */
export default function KpiCard({
  label,
  value,
  accent = "default",
  sub,
  href,
  hint,
}: {
  label: ReactNode;
  value: ReactNode;
  accent?: KpiAccent;
  sub?: ReactNode;
  href?: string;
  hint?: string;
}) {
  const body = (
    <>
      <div className={`text-3xl font-bold tabular-nums ${ACCENT_CLASS[accent]}`}>
        {value}
      </div>
      <div className="text-sm text-muted mt-1">{label}</div>
      {sub != null && <div className="text-xs text-muted mt-2">{sub}</div>}
    </>
  );

  if (href) {
    return (
      <Link
        href={href}
        title={hint}
        className="card p-5 block hover:border-ember/60 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-ember"
      >
        {body}
      </Link>
    );
  }
  return (
    <div className="card p-5" title={hint}>
      {body}
    </div>
  );
}
