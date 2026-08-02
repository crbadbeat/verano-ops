"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import type { ChangeEvent } from "react";

export type WarehouseOption = {
  id: string;
  code: string;
  name: string;
  isDefaultWarehouse: boolean;
};

/**
 * Picks which warehouse's stock the page shows, driving a `?wh=<id>` param.
 * Server reads it and rolls up on-hand for that warehouse. Changing site starts
 * back on page 1 but keeps the search / sort / filter you were using.
 */
export default function WarehouseSelector({
  warehouses,
  selectedId,
}: {
  warehouses: WarehouseOption[];
  selectedId: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function onChange(event: ChangeEvent<HTMLSelectElement>) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("wh", event.target.value);
    params.delete("page");
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="text-muted">Warehouse</span>
      <select
        value={selectedId}
        onChange={onChange}
        className="input py-1.5 max-w-[16rem]"
        aria-label="Select warehouse"
      >
        {warehouses.map((w) => (
          <option key={w.id} value={w.id}>
            {w.name}
            {w.isDefaultWarehouse ? " (default)" : ""}
          </option>
        ))}
      </select>
    </label>
  );
}
