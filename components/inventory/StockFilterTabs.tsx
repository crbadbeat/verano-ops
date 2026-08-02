"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

export type StockFilter = "instock" | "below" | "all";

export const STOCK_FILTERS: { id: StockFilter; label: string }[] = [
  { id: "instock", label: "In stock" },
  { id: "below", label: "Below max" },
  { id: "all", label: "All items" },
];

/**
 * Quick filters for the stock view, driving a `?filter=` param. Kept in the URL
 * so a filtered view is shareable and survives a refresh; a new filter resets
 * paging. The count next to each label is computed server-side.
 */
export default function StockFilterTabs({
  active,
  counts,
}: {
  active: StockFilter;
  counts: Record<StockFilter, number>;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function href(id: StockFilter): string {
    const params = new URLSearchParams(searchParams.toString());
    params.set("filter", id);
    params.delete("page");
    return `${pathname}?${params.toString()}`;
  }

  return (
    <div className="flex flex-wrap gap-1">
      {STOCK_FILTERS.map((f) => {
        const on = f.id === active;
        return (
          <Link
            key={f.id}
            href={href(f.id)}
            scroll={false}
            className={`badge ${
              on ? "text-ember border-ember/60" : "text-muted hover:text-foreground"
            }`}
          >
            {f.label}
            <span className="tabular-nums opacity-70">{counts[f.id]}</span>
          </Link>
        );
      })}
    </div>
  );
}
