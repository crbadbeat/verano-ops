"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";

const PRESETS: { key: string; label: string }[] = [
  { key: "week", label: "This week" },
  { key: "mtd", label: "MTD" },
  { key: "d7", label: "7d" },
  { key: "d30", label: "30d" },
  { key: "d90", label: "90d" },
];

/** Preset date-range switcher; writes `?preset=` and clears any custom from/to. */
export default function DateRangeControl({ current }: { current: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function set(preset: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("preset", preset);
    params.delete("from");
    params.delete("to");
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  return (
    <div className="inline-flex rounded-lg border border-border overflow-hidden" role="group" aria-label="Date range">
      {PRESETS.map((preset) => (
        <button
          key={preset.key}
          type="button"
          onClick={() => set(preset.key)}
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
  );
}
