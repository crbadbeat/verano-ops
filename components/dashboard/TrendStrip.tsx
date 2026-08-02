import type { ReactNode } from "react";

export type TrendPoint = { label: string; value: number };
export type TrendTone = "ember" | "teal" | "danger" | "success";

const TONE_VAR: Record<TrendTone, string> = {
  ember: "var(--ember)",
  teal: "var(--teal)",
  danger: "var(--danger)",
  success: "var(--success)",
};

/**
 * A single-series magnitude-over-time sparkline: baseline-anchored bars, the
 * most recent bar emphasized, a recessive baseline, native <title> hover per bar.
 * Server-rendered inline SVG — no client charting dependency, CSP-clean.
 * One series only, so it needs no legend; the surrounding tile/section names it.
 */
export default function TrendStrip({
  points,
  tone = "ember",
  height = 40,
  ariaLabel,
}: {
  points: TrendPoint[];
  tone?: TrendTone;
  height?: number;
  ariaLabel?: string;
}): ReactNode {
  if (points.length === 0) {
    return <div className="text-xs text-muted">No data in range</div>;
  }

  const barW = 8;
  const gap = 3;
  const pad = 1;
  const width = points.length * (barW + gap) - gap + pad * 2;
  const max = Math.max(1, ...points.map((p) => p.value));
  const usableH = height - 2; // leave 2px for the baseline rule
  const color = TONE_VAR[tone];
  const last = points.length - 1;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      height={height}
      preserveAspectRatio="none"
      role="img"
      aria-label={`${ariaLabel ?? "Trend"} — most recent ${points[last].value}`}
      className="block"
    >
      <line
        x1="0"
        y1={height - 1}
        x2={width}
        y2={height - 1}
        stroke="var(--border)"
        strokeWidth="1"
      />
      {points.map((p, i) => {
        const h = p.value <= 0 ? 0 : Math.max(2, (p.value / max) * usableH);
        const x = pad + i * (barW + gap);
        const y = height - 1 - h;
        return (
          <rect
            key={i}
            x={x}
            y={y}
            width={barW}
            height={h}
            rx="1.5"
            fill={color}
            opacity={i === last ? 1 : 0.5}
          >
            <title>
              {p.label}: {p.value}
            </title>
          </rect>
        );
      })}
    </svg>
  );
}
