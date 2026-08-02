"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

/** Prev / next pager that preserves every other query param. */
export default function Pagination({
  page,
  totalPages,
}: {
  page: number;
  totalPages: number;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  if (totalPages <= 1) return null;

  function href(target: number) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("page", String(target));
    return `${pathname}?${params.toString()}`;
  }

  const prevDisabled = page <= 1;
  const nextDisabled = page >= totalPages;

  return (
    <div className="flex items-center justify-between gap-3 p-4 border-t border-border text-sm">
      <span className="text-muted tabular-nums">
        Page {page} of {totalPages}
      </span>
      <div className="flex gap-2">
        {prevDisabled ? (
          <span className="btn btn-ghost py-1 px-3 text-sm opacity-40 pointer-events-none">
            ← Prev
          </span>
        ) : (
          <Link href={href(page - 1)} scroll={false} className="btn btn-ghost py-1 px-3 text-sm">
            ← Prev
          </Link>
        )}
        {nextDisabled ? (
          <span className="btn btn-ghost py-1 px-3 text-sm opacity-40 pointer-events-none">
            Next →
          </span>
        ) : (
          <Link href={href(page + 1)} scroll={false} className="btn btn-ghost py-1 px-3 text-sm">
            Next →
          </Link>
        )}
      </div>
    </div>
  );
}
