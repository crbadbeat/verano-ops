import Link from "next/link";
import { moneyFloor, moneyCompact, pctFloor } from "@/lib/reporting/format";
import { EVENT_STATUS_LABEL } from "@/lib/events";
import type { RepStat, LeaderShowLine } from "@/lib/reporting/shows";
import RepAvatar from "@/components/employees/RepAvatar";

// -----------------------------------------------------------------------------
// Shared, server-rendered presentational pieces for the PGI show dashboards
// (Active shows + Analytics). Pure + tokenized — no client JS, no hooks — so they
// drop into the server components directly. House style: bg-surface / surface-2
// elevation, ember + teal accents, tabular-nums figures, no drop shadows.
// -----------------------------------------------------------------------------

type Tone = "default" | "teal" | "ember" | "success" | "muted";

const TONE_TEXT: Record<Tone, string> = {
  default: "text-foreground",
  teal: "text-teal",
  ember: "text-ember",
  success: "text-success",
  muted: "text-muted",
};
const TONE_VAR: Record<Tone, string> = {
  default: "var(--foreground)",
  teal: "var(--teal)",
  ember: "var(--ember)",
  success: "var(--success)",
  muted: "var(--muted)",
};

const mix = (c: string, pct: number) => `color-mix(in srgb, ${c} ${pct}%, transparent)`;

/** Threshold colour for goal progress — ember → teal → success as it fills. */
export function goalColor(pct: number | null): string {
  if (pct == null) return "var(--muted)";
  return pct >= 1 ? "var(--success)" : pct >= 0.6 ? "var(--teal)" : "var(--ember)";
}

const STATUS_VAR: Record<string, string> = {
  CONFIRMED: "var(--teal)",
  ACTIVE: "var(--ember)",
  COMPLETED: "var(--showgood)",
  CANCELLED: "var(--danger)",
  PLANNED: "var(--muted)",
};

/** Status dot + label pill in the app's one status colour language. */
export function StatusPill({ status }: { status: string }) {
  const c = STATUS_VAR[status] ?? "var(--muted)";
  return (
    <span className="badge" style={{ color: c, borderColor: mix(c, 40) }}>
      <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: c }} />
      {EVENT_STATUS_LABEL[status as keyof typeof EVENT_STATUS_LABEL] ?? status}
    </span>
  );
}

/** A page-level KPI tile with a subtle toned edge. */
export function StatTile({
  label,
  value,
  sub,
  tone = "default",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: Tone;
}) {
  const accent = tone !== "default" && tone !== "muted";
  return (
    <div
      className="card px-4 py-3.5"
      style={accent ? { borderLeft: `3px solid ${TONE_VAR[tone]}` } : undefined}
    >
      <div className={`text-2xl font-bold tabular-nums leading-tight ${TONE_TEXT[tone]}`}>{value}</div>
      <div className="text-xs text-muted mt-1">{label}</div>
      {sub && <div className="text-[11px] text-muted mt-0.5">{sub}</div>}
    </div>
  );
}

/** A compact stat "card" for inside a show block (Orders / AOV / Reps / Goal). */
export function MiniStat({ label, value, tone = "default" }: { label: string; value: string; tone?: Tone }) {
  return (
    <div className="rounded-xl border border-border bg-surface-2/40 px-3 py-2.5">
      <div className={`text-lg font-bold tabular-nums leading-tight ${TONE_TEXT[tone]}`}>{value}</div>
      <div className="text-[11px] uppercase tracking-wide text-muted mt-0.5">{label}</div>
    </div>
  );
}

/**
 * Radial goal meter: an SVG ring filled to %-of-goal with the % in the centre and
 * the sales figure beneath. Colour shifts ember→teal→success as it approaches the
 * goal. Inline SVG (CSP-clean, no charting lib).
 */
export function GoalRing({
  pct,
  salesCents,
  goalCents,
  size = 156,
}: {
  pct: number | null;
  salesCents: number;
  goalCents: number | null;
  size?: number;
}) {
  const R = 52;
  const C = 2 * Math.PI * R;
  const p = pct == null ? 0 : Math.max(0, Math.min(1, pct));
  const color = goalColor(pct);
  const over = pct != null && pct > 1;
  const big = size >= 190;
  return (
    <div className="relative mx-auto" style={{ width: size, height: size }}>
      <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90" aria-hidden="true">
        <circle cx="60" cy="60" r={R} fill="none" stroke="var(--surface-2)" strokeWidth="10" />
        <circle
          cx="60"
          cy="60"
          r={R}
          fill="none"
          stroke={color}
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={C}
          strokeDashoffset={C * (1 - p)}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-4">
        <div className={`font-bold tabular-nums leading-none ${big ? "text-5xl" : "text-3xl"}`} style={{ color }}>
          {pctFloor(pct)}
        </div>
        <div className={`text-muted mt-1 ${big ? "text-xs" : "text-[11px]"}`}>{goalCents ? `of ${moneyCompact(goalCents)}` : "no goal"}</div>
        <div className={`mt-2 font-semibold tabular-nums text-teal leading-none ${big ? "text-2xl" : "text-base"}`}>{moneyFloor(salesCents)}</div>
        {over && <div className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-success">Goal beat</div>}
      </div>
    </div>
  );
}

/**
 * Per-day sales columns (one bar per show-day). A non-zero day always renders a
 * visible bar (min height), so a small early sale reads clearly instead of hugging
 * the baseline the way a cumulative line does. Empty days are faint stubs.
 */
export function SalesBars({ points, color = "var(--teal)", height = 40 }: { points: number[]; color?: string; height?: number }) {
  if (points.length === 0) return <div style={{ height }} />;
  const max = Math.max(...points, 1);
  const minActive = Math.max(6, Math.round(height * 0.18));
  return (
    <div className="flex items-end gap-[3px] max-w-[320px]" style={{ height }} aria-hidden="true">
      {points.map((v, i) => {
        const active = v > 0;
        const h = active ? Math.max(minActive, Math.round((v / max) * height)) : 3;
        return (
          <div
            key={i}
            className="flex-1 rounded-t-[2px]"
            style={{ minWidth: 3, maxWidth: 22, height: h, background: active ? color : "var(--border)", opacity: active ? 1 : 0.6 }}
          />
        );
      })}
    </div>
  );
}

/** A tiny inline SVG line sparkline (cumulative trend). No axes, no lib. */
export function Sparkline({ points, color = "var(--teal)", width = 240, height = 44 }: { points: number[]; color?: string; width?: number; height?: number }) {
  if (points.length < 2) return <div style={{ height }} />;
  const max = Math.max(...points, 1);
  const min = Math.min(...points, 0);
  const span = max - min || 1;
  const dx = width / (points.length - 1);
  const y = (v: number) => height - 4 - ((v - min) / span) * (height - 8);
  const coords = points.map((v, i) => [i * dx, y(v)] as const);
  const line = coords.map(([x, yy], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${yy.toFixed(1)}`).join(" ");
  const area = `${line} L${width} ${height} L0 ${height} Z`;
  const [lx, ly] = coords[coords.length - 1];
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full" style={{ height }} preserveAspectRatio="none" aria-hidden="true">
      <path d={area} fill={color} opacity={0.12} />
      <path d={line} fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      <circle cx={lx} cy={ly} r="3.5" fill={color} />
    </svg>
  );
}

/**
 * A compact goal ring for the at-a-glance scoreboard: a small radial meter with
 * the %-to-goal in the centre, the show's short label, and an on-track pill.
 * Links to the show. Sized to pack many across (auto-fitting grid on the page).
 */
export function MiniGoalRing({
  href,
  label,
  pct,
  salesCents,
  onTrack,
}: {
  href?: string;
  label: string;
  pct: number | null;
  salesCents: number;
  onTrack: boolean | null;
}) {
  const R = 27;
  const C = 2 * Math.PI * R;
  const p = pct == null ? 0 : Math.max(0, Math.min(1, pct));
  const color = goalColor(pct);
  const cls =
    "flex flex-col items-center gap-1.5 rounded-xl border border-border bg-surface-2/30 px-2 py-3 transition-colors hover:border-ember/60";
  const inner = (
    <>
      <div className="relative" style={{ width: 72, height: 72 }}>
        <svg viewBox="0 0 64 64" className="h-full w-full -rotate-90" aria-hidden="true">
          <circle cx="32" cy="32" r={R} fill="none" stroke="var(--surface-2)" strokeWidth="6" />
          <circle
            cx="32"
            cy="32"
            r={R}
            fill="none"
            stroke={color}
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={C}
            strokeDashoffset={C * (1 - p)}
          />
        </svg>
        <div
          className="absolute inset-0 flex items-center justify-center text-sm font-bold tabular-nums"
          style={{ color }}
        >
          {pctFloor(pct)}
        </div>
      </div>
      <div className="text-sm font-semibold tabular-nums text-teal leading-none">{moneyFloor(salesCents)}</div>
      <div className="text-xs font-medium text-center leading-tight line-clamp-2 max-w-full">{label}</div>
      {onTrack != null && <Pill tone={onTrack ? "success" : "ember"}>{onTrack ? "On track" : "Behind"}</Pill>}
    </>
  );
  return href ? (
    <Link href={href} title={label} className={cls}>
      {inner}
    </Link>
  ) : (
    <div title={label} className={cls}>
      {inner}
    </div>
  );
}

/** A small pill (colored text + matching hairline border). */
export function Pill({ children, tone }: { children: React.ReactNode; tone: Tone }) {
  const c = TONE_VAR[tone];
  return (
    <span className="badge" style={{ color: c, borderColor: mix(c, 40) }}>
      {children}
    </span>
  );
}

/**
 * A leader's shows as a ranked list — magnitude bars scaled to the leader's best
 * show, each show's %-to-goal + sales. Links to the show. This is the "show
 * details" inside a LeaderStatCard.
 */
export function RankedShows({ shows }: { shows: LeaderShowLine[] }) {
  return (
    <ol className="space-y-3">
      {shows.map((s) => {
        const p = s.pctToGoal;
        const width = p == null ? 0 : Math.max(2, Math.min(100, p * 100)); // bar = % to goal
        const color = goalColor(p);
        const aovC = s.count ? Math.round(s.salesCents / s.count) : 0;
        return (
          <li key={s.showId} className="min-w-0">
            <div className="flex items-baseline justify-between gap-3">
              <Link
                href={`/events/${s.showId}`}
                className="truncate text-sm font-medium hover:text-ember hover:underline"
              >
                {s.shortName?.trim() || s.name}
              </Link>
              <div className="flex items-center gap-3 sm:gap-4 shrink-0 text-xs text-muted tabular-nums">
                <span className="hidden sm:inline">{s.count} {s.count === 1 ? "ord" : "ords"}</span>
                <span className="hidden md:inline">AOV {moneyCompact(aovC)}</span>
                <span className="hidden sm:inline">Goal {s.goalCents ? moneyCompact(s.goalCents) : "—"}</span>
                <span className="text-teal font-semibold text-sm">{moneyFloor(s.salesCents)}</span>
              </div>
            </div>
            <div className="mt-1.5 flex items-center gap-2">
              <div className="h-2 flex-1 rounded-full bg-surface-2 overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${width}%`, background: color }} />
              </div>
              <span className="w-10 shrink-0 text-right text-xs tabular-nums" style={{ color }}>
                {pctFloor(p)}
              </span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * Ranked rep leaderboard — magnitude bars on a shared scale (top rep = full), 🔥
 * on the leader. Denser + more legible than a plain table.
 */
export function RankedReps({ reps, limit }: { reps: RepStat[]; limit?: number }) {
  const rows = limit ? reps.slice(0, limit) : reps;
  const top = rows.length ? rows[0].salesCents : 0;
  return (
    <ol className="space-y-2.5">
      {rows.map((r, i) => {
        const w = top > 0 ? Math.max(4, Math.round((r.salesCents / top) * 100)) : 0;
        const leader = i === 0;
        return (
          <li key={r.repId} className="flex items-center gap-3">
            <span className="w-4 shrink-0 text-center text-sm tabular-nums text-muted">
              {leader ? "🔥" : i + 1}
            </span>
            <RepAvatar id={r.repId} name={r.repName} size={28} />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate text-sm">
                  {r.repName}
                  <span className="text-muted text-xs"> · {r.count} {r.count === 1 ? "order" : "orders"}</span>
                </span>
                <span className="shrink-0 tabular-nums text-sm font-semibold text-teal">{moneyFloor(r.salesCents)}</span>
              </div>
              <div className="mt-1 h-1.5 rounded-full bg-surface-2 overflow-hidden">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${w}%`, background: leader ? "var(--ember)" : mix("var(--ember)", 55) }}
                />
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
