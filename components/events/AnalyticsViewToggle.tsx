"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";

const VIEWS = [
  { key: "leaders", label: "Leaders" },
  { key: "shows", label: "Shows" },
];

/** Leaders / Shows switch for the analytics page — writes ?view= while keeping
 *  the current range params. */
export default function AnalyticsViewToggle({ current }: { current: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function setView(view: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("view", view);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  return (
    <div className="inline-flex rounded-lg border border-border overflow-hidden" role="tablist" aria-label="View">
      {VIEWS.map((v) => (
        <button
          key={v.key}
          type="button"
          role="tab"
          aria-selected={current === v.key}
          onClick={() => setView(v.key)}
          className={`px-4 py-1.5 text-sm transition-colors ${
            current === v.key ? "bg-surface-2 text-foreground font-medium" : "text-muted hover:bg-surface-2/60"
          }`}
        >
          {v.label}
        </button>
      ))}
    </div>
  );
}
