"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";

const PRESETS = [
  { key: "mtd", label: "MTD" },
  { key: "tm", label: "This month" },
  { key: "ytd", label: "YTD" },
];

/** Preset buttons (MTD / This month / YTD) + a custom from–to range for the
 *  shows analytics view. Writes ?preset= or ?from=&to=. */
export default function EventsRangeControl({
  current,
  from,
  to,
}: {
  current: string;
  from: string;
  to: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function setPreset(preset: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("preset", preset);
    params.delete("from");
    params.delete("to");
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  function setCustom(next: { from?: string; to?: string }) {
    const params = new URLSearchParams(searchParams.toString());
    const f = next.from ?? from;
    const t = next.to ?? to;
    if (!f || !t) return;
    params.delete("preset");
    params.set("from", f);
    params.set("to", t);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="inline-flex rounded-lg border border-border overflow-hidden">
        {PRESETS.map((p) => (
          <button
            key={p.key}
            type="button"
            onClick={() => setPreset(p.key)}
            aria-pressed={current === p.key}
            className={`px-3 py-1.5 text-sm ${
              current === p.key ? "bg-surface-2 text-foreground" : "text-muted hover:bg-surface-2/60"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>
      <div className="inline-flex items-center gap-1.5 text-sm">
        <input
          type="date"
          value={from}
          onChange={(e) => setCustom({ from: e.target.value })}
          aria-label="From"
          className="rounded-lg border border-border bg-surface px-2 py-1.5 text-sm text-foreground"
        />
        <span className="text-muted">–</span>
        <input
          type="date"
          value={to}
          onChange={(e) => setCustom({ to: e.target.value })}
          aria-label="To"
          className="rounded-lg border border-border bg-surface px-2 py-1.5 text-sm text-foreground"
        />
      </div>
    </div>
  );
}
