"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import type { ChangeEvent } from "react";

/** Warehouse scope selector; writes `?site=<id|all>` and keeps other params. */
export default function SiteSelector({
  sites,
  current,
  includeAll = true,
}: {
  sites: { id: string; label: string }[];
  current: string;
  includeAll?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function onChange(event: ChangeEvent<HTMLSelectElement>) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("site", event.target.value);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  return (
    <select
      value={current}
      onChange={onChange}
      aria-label="Warehouse"
      className="input max-w-56 py-1.5"
    >
      {includeAll && <option value="all">All sites</option>}
      {sites.map((site) => (
        <option key={site.id} value={site.id}>
          {site.label}
        </option>
      ))}
    </select>
  );
}
