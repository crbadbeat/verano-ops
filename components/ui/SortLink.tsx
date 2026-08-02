"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import type { ReactNode } from "react";

/**
 * A sortable column header. Clicking toggles `?sort=<column>&dir=asc|desc` and
 * resets pagination; the page reads those params and orders the query. Keeping
 * sort in the URL means it is shareable and survives a refresh.
 */
export default function SortLink({
  column,
  children,
}: {
  column: string;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const activeColumn = searchParams.get("sort");
  const activeDir = searchParams.get("dir") === "asc" ? "asc" : "desc";
  const active = activeColumn === column;
  const nextDir = active && activeDir === "asc" ? "desc" : "asc";

  const params = new URLSearchParams(searchParams.toString());
  params.set("sort", column);
  params.set("dir", nextDir);
  params.delete("page");

  return (
    <Link
      href={`${pathname}?${params.toString()}`}
      scroll={false}
      className={`inline-flex items-center gap-1 hover:text-foreground ${
        active ? "text-foreground" : ""
      }`}
    >
      {children}
      <span aria-hidden className="text-xs">
        {active ? (activeDir === "asc" ? "↑" : "↓") : ""}
      </span>
    </Link>
  );
}
