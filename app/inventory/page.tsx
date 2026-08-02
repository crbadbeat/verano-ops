import Link from "next/link";
import { getViewer } from "@/lib/permissions/engine";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";

import { can } from "@/lib/rbac";
import {
  stockByWarehouse,
  stockAt,
  splitTotal,
  costsForWarehouse,
  type StockSplit,
} from "@/lib/inventory";
import { getOverheadBps } from "@/lib/settings";
import { productDisplayName } from "@/lib/item-master";
import { burdenedCost, bpsToPercentString } from "@/lib/overhead";
import PageHeader from "@/components/ui/PageHeader";
import KpiCard from "@/components/ui/KpiCard";
import DataTable, { type Column } from "@/components/ui/DataTable";
import SearchBox from "@/components/ui/SearchBox";
import Pagination from "@/components/ui/Pagination";
import EmptyState from "@/components/ui/EmptyState";
import WarehouseSelector from "@/components/inventory/WarehouseSelector";
import StockFilterTabs, {
  type StockFilter,
} from "@/components/inventory/StockFilterTabs";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

type Row = {
  id: string;
  sku: string;
  name: string; // resolved: displayName ?? name ?? sku
  nsName: string; // NetSuite's own name, kept for search even when overridden
  description: string | null;
  category: string | null;
  maxStockLevel: number | null;
  netsuiteLinkedAt: Date | null;
  split: StockSplit;
  total: number;
  belowMax: boolean;
  /** Average cost (cents): warehouse-specific if synced, else the account-wide average. */
  unitCostCents: number | null;
  /** Whether unitCostCents is this warehouse's own cost (vs the account-wide fallback). */
  costIsWarehouse: boolean;
  /** Extended value (cents) = on-hand × unit cost; null when no cost is known. */
  valueCents: number | null;
};

function usd(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<{
    wh?: string;
    q?: string;
    sort?: string;
    dir?: string;
    filter?: string;
    page?: string;
  }>;
}) {
  const user = await getViewer();
  if (!can(user, "inventory:view")) notFound();

  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const filter: StockFilter =
    sp.filter === "below" ? "below" : sp.filter === "all" ? "all" : "instock";
  const sortKey = sp.sort ?? "onhand";
  const dir: "asc" | "desc" = sp.dir === "asc" ? "asc" : "desc";

  // Warehouses to choose from; default = the flagged default (Ocoee).
  const warehouses = await prisma.location.findMany({
    where: { type: "WAREHOUSE" },
    orderBy: [{ isDefaultWarehouse: "desc" }, { name: "asc" }],
    select: { id: true, code: true, name: true, isDefaultWarehouse: true, overheadExempt: true },
  });

  if (warehouses.length === 0) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-10 space-y-8">
        <PageHeader title="Stock" description="Per-warehouse on-hand, derived from the audit ledger." />
        <div className="card">
          <EmptyState
            title="No warehouses yet"
            message="Add a warehouse under Locations & bins before viewing stock."
            action={
              <Link href="/locations" className="btn btn-ghost">
                Locations & bins
              </Link>
            }
          />
        </div>
      </div>
    );
  }

  const selected =
    warehouses.find((w) => w.id === sp.wh) ??
    warehouses.find((w) => w.isDefaultWarehouse) ??
    warehouses[0];

  const [products, byWarehouse, whCosts, overheadBps] = await Promise.all([
    prisma.product.findMany({
      where: { active: true },
      select: {
        id: true,
        sku: true,
        displayName: true,
        name: true,
        description: true,
        category: true,
        maxStockLevel: true,
        netsuiteLinkedAt: true,
        standardCostCents: true,
      },
    }),
    stockByWarehouse(),
    costsForWarehouse(selected.id),
    getOverheadBps(),
  ]);

  // Rows for the selected warehouse (every active product; 0/0 if none here).
  // Average cost prefers this warehouse's own NetSuite cost, then the account-wide
  // average, plus the landed-cost overhead (unless the warehouse is exempt);
  // extended value = on-hand × that cost.
  const allRows: Row[] = products.map((p) => {
    const split = stockAt(byWarehouse, selected.id, p.id);
    const total = splitTotal(split);
    const whCost = whCosts.get(p.id) ?? null;
    const base = whCost ?? p.standardCostCents ?? null;
    const unitCostCents = base != null ? burdenedCost(base, overheadBps, selected.overheadExempt) : null;
    return {
      id: p.id,
      sku: p.sku,
      name: productDisplayName(p),
      nsName: p.name,
      description: p.description,
      category: p.category,
      maxStockLevel: p.maxStockLevel,
      netsuiteLinkedAt: p.netsuiteLinkedAt,
      split,
      total,
      belowMax: p.maxStockLevel != null && total < p.maxStockLevel,
      unitCostCents,
      costIsWarehouse: whCost != null,
      valueCents: unitCostCents != null ? total * unitCostCents : null,
    };
  });

  // KPIs across the whole warehouse (before any search / filter).
  const inStock = allRows.filter((r) => r.total > 0);
  const totalUnits = allRows.reduce((s, r) => s + r.total, 0);
  const showGoodUnits = allRows.reduce((s, r) => s + r.split.showGood, 0);
  const belowMaxCount = allRows.filter((r) => r.belowMax).length;

  // Inventory value is only meaningful once NetSuite has synced average costs;
  // gate the tile until at least one product carries a cost. Sums each row's
  // extended value (warehouse-specific cost where synced, else account-wide).
  const hasCost = allRows.some((r) => r.unitCostCents != null);
  const valueCents = allRows.reduce((s, r) => s + (r.valueCents ?? 0), 0);

  // Search applies first (across the full catalogue), then the stock filter.
  const needle = q.toLowerCase();
  const searched = q
    ? allRows.filter(
        (r) =>
          r.sku.toLowerCase().includes(needle) ||
          r.name.toLowerCase().includes(needle) ||
          r.nsName.toLowerCase().includes(needle) ||
          (r.description ?? "").toLowerCase().includes(needle)
      )
    : allRows;

  const counts: Record<StockFilter, number> = {
    instock: searched.filter((r) => r.total > 0).length,
    below: searched.filter((r) => r.belowMax).length,
    all: searched.length,
  };

  const filtered =
    filter === "instock"
      ? searched.filter((r) => r.total > 0)
      : filter === "below"
      ? searched.filter((r) => r.belowMax)
      : searched;

  // Sort — default is on-hand desc, the natural order for a stock view.
  const factor = dir === "asc" ? 1 : -1;
  const sorted = [...filtered].sort((a, b) => {
    let cmp = 0;
    switch (sortKey) {
      case "sku":
        cmp = a.sku.localeCompare(b.sku);
        break;
      case "name":
        cmp = a.name.localeCompare(b.name);
        break;
      case "new":
        cmp = a.split.new - b.split.new;
        break;
      case "showgood":
        cmp = a.split.showGood - b.split.showGood;
        break;
      case "max":
        cmp = (a.maxStockLevel ?? -1) - (b.maxStockLevel ?? -1);
        break;
      case "cost":
        cmp = (a.unitCostCents ?? -1) - (b.unitCostCents ?? -1);
        break;
      case "value":
        cmp = (a.valueCents ?? -1) - (b.valueCents ?? -1);
        break;
      default:
        cmp = a.total - b.total;
    }
    if (cmp === 0) cmp = a.sku.localeCompare(b.sku);
    return cmp * factor;
  });

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const page = Math.min(Math.max(1, Number(sp.page) || 1), totalPages);
  const pageRows = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // Download the current view (warehouse + filter + search) as CSV.
  const exportParams = new URLSearchParams({ wh: selected.id, filter });
  if (q) exportParams.set("q", q);
  const exportHref = `/inventory/export?${exportParams.toString()}`;

  const columns: Column<Row>[] = [
    {
      key: "sku",
      header: "SKU",
      sortable: true,
      cell: (r) => (
        <Link
          href={`/inventory/${r.id}`}
          className="font-mono text-xs hover:text-ember hover:underline break-all"
        >
          {r.sku}
        </Link>
      ),
    },
    {
      key: "name",
      header: "Item",
      sortable: true,
      cell: (r) => (
        <div className="min-w-0">
          <div className="truncate">{r.name}</div>
          {r.category && <div className="text-xs text-muted">{r.category}</div>}
        </div>
      ),
    },
    {
      key: "new",
      header: "New",
      align: "right",
      sortable: true,
      cell: (r) => <span className="tabular-nums">{r.split.new}</span>,
    },
    {
      key: "showgood",
      header: "Show good",
      align: "right",
      sortable: true,
      cell: (r) =>
        r.split.showGood !== 0 ? (
          <span className="tabular-nums text-showgood">{r.split.showGood}</span>
        ) : (
          <span className="text-muted">—</span>
        ),
    },
    {
      key: "onhand",
      header: "On hand",
      align: "right",
      sortable: true,
      cell: (r) => (
        <div className="flex items-center justify-end gap-2">
          {r.belowMax && (
            <span className="badge text-ember" title={`Below max of ${r.maxStockLevel}`}>
              below max
            </span>
          )}
          <span className={`font-semibold tabular-nums ${r.total < 0 ? "text-danger" : ""}`}>
            {r.total}
          </span>
        </div>
      ),
    },
    {
      key: "max",
      header: "Max",
      align: "right",
      sortable: true,
      cell: (r) => (
        <span className="tabular-nums text-muted">{r.maxStockLevel ?? "—"}</span>
      ),
    },
    {
      key: "cost",
      header: "Avg cost",
      align: "right",
      sortable: true,
      cell: (r) =>
        r.unitCostCents != null ? (
          <span
            className="tabular-nums"
            title={
              r.costIsWarehouse
                ? "NetSuite average cost at this warehouse"
                : "Account-wide NetSuite average cost (no warehouse-specific cost synced)"
            }
          >
            {usd(r.unitCostCents)}
            {!r.costIsWarehouse && <span className="text-muted"> *</span>}
          </span>
        ) : (
          <span className="text-muted">—</span>
        ),
    },
    {
      key: "value",
      header: "Value",
      align: "right",
      sortable: true,
      cell: (r) =>
        r.valueCents != null ? (
          <span className="tabular-nums font-medium">{usd(r.valueCents)}</span>
        ) : (
          <span className="text-muted">—</span>
        ),
    },
  ];

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 space-y-8">
      <PageHeader
        eyebrow="Inventory"
        title="Stock"
        description="Per-warehouse on-hand, rolled up from every bin and derived from the audit ledger — every number is traceable."
        actions={
          <>
            <Link href="/inventory/dashboard" className="btn btn-ghost text-sm">
              Dashboard
            </Link>
            {can(user, "catalog:edit") && (
              <Link href="/inventory/netsuite-queue" className="btn btn-ghost text-sm">
                NetSuite queue
              </Link>
            )}
            <Link href="/inventory/sku-review" className="btn btn-ghost text-sm">
              SKU review
            </Link>
            <Link href="/inventory/labels" className="btn btn-ghost text-sm">
              Labels
            </Link>
            {can(user, "catalog:import") && (
              <Link href="/admin/data" className="btn btn-primary text-sm">
                Import
              </Link>
            )}
          </>
        }
      />

      <div className="flex items-center gap-3 flex-wrap">
        <WarehouseSelector
          warehouses={warehouses}
          selectedId={selected.id}
        />
        <span className="badge font-mono text-muted">{selected.code}</span>
        {selected.isDefaultWarehouse && <span className="badge text-teal">default</span>}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        <KpiCard label="SKUs in stock" value={inStock.length} />
        <KpiCard label="Units on hand" value={totalUnits} accent="teal" />
        <KpiCard
          label="Show-good units"
          value={showGoodUnits}
          accent={showGoodUnits > 0 ? "showgood" : "default"}
        />
        <KpiCard
          label="Below max"
          value={belowMaxCount}
          accent={belowMaxCount > 0 ? "ember" : "default"}
        />
        {hasCost ? (
          <KpiCard
            label="Stock value"
            value={usd(valueCents)}
            hint="Derived from NetSuite standard cost × on-hand at this warehouse."
          />
        ) : (
          <KpiCard
            label="Stock value"
            value="—"
            sub="Awaiting NetSuite cost sync"
            hint="Standard costs sync from NetSuite; value unlocks once they land."
          />
        )}
      </div>

      <div className="card overflow-hidden">
        <div className="p-4 border-b border-border flex items-center gap-3 flex-wrap">
          <h2 className="font-semibold">Products</h2>
          <span className="badge">{sorted.length}</span>
          <StockFilterTabs active={filter} counts={counts} />
          <div className="ml-auto flex items-center gap-2">
            <a href={exportHref} className="btn btn-ghost text-sm whitespace-nowrap" download>
              Download CSV
            </a>
            <SearchBox placeholder="Search SKU, name or description…" />
          </div>
        </div>

        <DataTable
          columns={columns}
          rows={pageRows}
          rowKey={(r) => r.id}
          emptyMessage={
            q
              ? `No products match “${q}” in this view.`
              : filter === "instock"
              ? "Nothing in stock at this warehouse. Switch to “All items” to see the full catalogue."
              : "No products to show."
          }
        />

        <Pagination page={page} totalPages={totalPages} />

        {hasCost && (
          <p className="px-4 py-2 text-xs text-muted border-t border-border">
            Avg cost ={" "}
            {selected.overheadExempt
              ? "the raw NetSuite average (this warehouse is overhead-exempt)"
              : `NetSuite average + ${bpsToPercentString(overheadBps)}% landed-cost overhead`}
            ; <span className="text-foreground">*</span> = account-wide average (no
            warehouse-specific cost synced). Value = on-hand × avg cost.
          </p>
        )}
      </div>
    </div>
  );
}
