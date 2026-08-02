"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";

// Year-scale range switcher for the sales cockpit: the presets that matter for a
// multi-year order book (year-to-date, prior year, all time) plus a per-year
// picker. Preserves every other query param (the drill scope) as it rewrites the
// window, mirroring DateRangeControl's shape.

const PRESETS: { key: string; label: string }[] = [
  { key: "ytd", label: "YTD" },
  { key: "py", label: "Prior yr" },
  { key: "all", label: "All time" },
];

export default function SalesRangeControl({
  current,
  minYear,
  maxYear,
}: {
  current: string; // "ytd" | "py" | "all" | "y2024"… | "custom"
  minYear: number;
  maxYear: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function go(params: URLSearchParams) {
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  function setPreset(preset: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("preset", preset);
    params.delete("from");
    params.delete("to");
    go(params);
  }

  function setYear(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (!value) return;
    params.delete("preset");
    params.set("from", `${value}-01-01`);
    params.set("to", `${value}-12-31`);
    go(params);
  }

  const years: number[] = [];
  for (let y = maxYear; y >= minYear; y--) years.push(y);
  const yearValue = current.startsWith("y") ? current.slice(1) : "";

  return (
    <div className="inline-flex items-center gap-2">
      <div className="inline-flex rounded-lg border border-border overflow-hidden" role="group" aria-label="Date range">
        {PRESETS.map((preset) => (
          <button
            key={preset.key}
            type="button"
            onClick={() => setPreset(preset.key)}
            aria-pressed={current === preset.key}
            className={`px-3 py-1.5 text-sm ${
              current === preset.key
                ? "bg-surface-2 text-foreground"
                : "text-muted hover:bg-surface-2/60"
            }`}
          >
            {preset.label}
          </button>
        ))}
      </div>
      <select
        value={yearValue}
        onChange={(e) => setYear(e.target.value)}
        aria-label="Sales year"
        className="rounded-lg border border-border bg-surface px-2 py-1.5 text-sm text-foreground"
      >
        <option value="">Year…</option>
        {years.map((y) => (
          <option key={y} value={y}>
            {y}
          </option>
        ))}
      </select>
    </div>
  );
}
