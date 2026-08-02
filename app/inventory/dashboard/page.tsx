import Link from "next/link";
import { getViewer } from "@/lib/permissions/engine";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";

import { can } from "@/lib/rbac";
import {
  onHandByProduct,
  showGoodOnHandByProduct,
  topMoversSince,
  lastMovementByProduct,
  valueByWarehouse,
  type MoverRow,
  type WarehouseValue,
} from "@/lib/inventory";
import { getOverheadBps } from "@/lib/settings";
import PageHeader from "@/components/ui/PageHeader";
import KpiCard from "@/components/ui/KpiCard";
import EmptyState from "@/components/ui/EmptyState";

export const dynamic = "force-dynamic";

const MOVERS_WINDOW_DAYS = 30;
const AGING_DAYS = 90;
const TOP_N = 10;

function usd(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

/** Whole-dollar currency (no cents) for the warehouse value breakdown. */
function usd0(cents: number): string {
  return (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

function daysAgo(date: Date, now: number): number {
  return Math.floor((now - date.getTime()) / 86_400_000);
}

type ExceptionRow = {
  id: string;
  sku: string;
  name: string;
  value: string | number;
  danger?: boolean;
  showgood?: boolean;
};

type AgingRow = { id: string; sku: string; name: string; qty: number; days: number };

type Dashboard = {
  activeSkus: number;
  totalUnits: number;
  showGoodUnits: number;
  unlinkedCount: number;
  hasCost: boolean;
  valueCents: number;
  warehouses: WarehouseValue[];
  movers: (MoverRow & { sku: string; name: string })[];
  maxMover: number;
  aging: AgingRow[];
  negatives: ExceptionRow[];
  belowMax: ExceptionRow[];
  belowMaxExtra: number;
  showGoodHolders: ExceptionRow[];
  showGoodExtra: number;
};

/**
 * All dashboard data + the request-time clock, computed OUTSIDE the component so
 * the component body stays pure (no Date.now() during render).
 */
async function loadDashboard(): Promise<Dashboard> {
  const now = Date.now();
  const since = new Date(now - MOVERS_WINDOW_DAYS * 86_400_000);
  const overheadBps = await getOverheadBps();

  const [products, onHand, showGood, movers, lastMoved, unlinkedCount, warehouses] =
    await Promise.all([
      prisma.product.findMany({
        where: { active: true },
        select: {
          id: true,
          sku: true,
          name: true,
          maxStockLevel: true,
          standardCostCents: true,
        },
      }),
      onHandByProduct(),
      showGoodOnHandByProduct(),
      topMoversSince(since, TOP_N),
      lastMovementByProduct(),
      prisma.product.count({ where: { active: true, netsuiteLinkedAt: null } }),
      valueByWarehouse(overheadBps),
    ]);

  const byId = new Map(products.map((p) => [p.id, p]));
  const nameOf = (id: string) => byId.get(id)?.name ?? "(unknown)";
  const skuOf = (id: string) => byId.get(id)?.sku ?? id;

  const totalUnits = products.reduce((s, p) => s + (onHand.get(p.id) ?? 0), 0);
  const showGoodUnits = [...showGood.values()].reduce((s, q) => s + q, 0);

  const hasCost = products.some((p) => p.standardCostCents != null);
  // Network value = sum of the per-warehouse values (warehouse-specific cost
  // where synced), so the KPI equals the breakdown shown below it.
  const valueCents = warehouses.reduce((s, w) => s + w.valueCents, 0);

  const negatives: ExceptionRow[] = products
    .map((p) => ({ p, qty: onHand.get(p.id) ?? 0 }))
    .filter((x) => x.qty < 0)
    .sort((a, b) => a.qty - b.qty)
    .map((x) => ({ id: x.p.id, sku: x.p.sku, name: x.p.name, value: x.qty, danger: true }));

  const belowMaxAll = products
    .map((p) => ({ p, qty: onHand.get(p.id) ?? 0 }))
    .filter((x) => x.p.maxStockLevel != null && x.qty < x.p.maxStockLevel!)
    .map((x) => ({ ...x, gap: x.p.maxStockLevel! - x.qty }))
    .sort((a, b) => b.gap - a.gap);

  const showGoodAll = [...showGood.entries()]
    .map(([id, qty]) => ({ id, qty }))
    .sort((a, b) => b.qty - a.qty);

  const aging: AgingRow[] = products
    .map((p) => ({ p, qty: onHand.get(p.id) ?? 0, last: lastMoved.get(p.id) }))
    .filter((x) => x.qty > 0 && x.last && daysAgo(x.last, now) >= AGING_DAYS)
    .sort((a, b) => a.last!.getTime() - b.last!.getTime())
    .slice(0, TOP_N)
    .map((x) => ({ id: x.p.id, sku: x.p.sku, name: x.p.name, qty: x.qty, days: daysAgo(x.last!, now) }));

  return {
    activeSkus: products.length,
    totalUnits,
    showGoodUnits,
    unlinkedCount,
    hasCost,
    valueCents,
    warehouses,
    movers: movers.map((m) => ({ ...m, sku: skuOf(m.productId), name: nameOf(m.productId) })),
    maxMover: movers.length ? movers[0].unitsOut : 0,
    aging,
    negatives,
    belowMax: belowMaxAll
      .slice(0, TOP_N)
      .map((x) => ({ id: x.p.id, sku: x.p.sku, name: x.p.name, value: `${x.qty}/${x.p.maxStockLevel}` })),
    belowMaxExtra: Math.max(0, belowMaxAll.length - TOP_N),
    showGoodHolders: showGoodAll
      .slice(0, TOP_N)
      .map((x) => ({ id: x.id, sku: skuOf(x.id), name: nameOf(x.id), value: x.qty, showgood: true })),
    showGoodExtra: Math.max(0, showGoodAll.length - TOP_N),
  };
}

export default async function InventoryDashboardPage() {
  const user = await getViewer();
  if (!can(user, "inventory:view")) notFound();

  const d = await loadDashboard();

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 space-y-8">
      <PageHeader
        eyebrow="Inventory"
        title="Dashboard"
        description="Network-wide movement, aging and exceptions — derived live from the ledger."
        actions={
          <Link href="/inventory" className="btn btn-ghost text-sm">
            ← Back to stock
          </Link>
        }
      />

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        <KpiCard label="Active SKUs" value={d.activeSkus} href="/inventory" />
        <KpiCard label="Units on hand" value={d.totalUnits} accent="teal" />
        <KpiCard
          label="Show-good units"
          value={d.showGoodUnits}
          accent={d.showGoodUnits > 0 ? "showgood" : "default"}
        />
        <KpiCard
          label="Unlinked to NetSuite"
          value={d.unlinkedCount}
          accent={d.unlinkedCount > 0 ? "ember" : "default"}
          href="/inventory/netsuite-queue"
        />
        {d.hasCost ? (
          <KpiCard label="Inventory value" value={usd(d.valueCents)} hint="Standard cost × on-hand, network-wide." />
        ) : (
          <KpiCard
            label="Inventory value"
            value="—"
            sub="Awaiting NetSuite cost sync"
            hint="Value unlocks once NetSuite standard costs sync in."
          />
        )}
      </div>

      {/* Value by warehouse — click a row to drill into its stock ------ */}
      {d.hasCost && (
        <div className="card overflow-hidden">
          <div className="p-4 border-b border-border flex items-center gap-3 flex-wrap">
            <h2 className="font-semibold">Value by warehouse</h2>
            <span className="text-xs text-muted ml-auto">
              on-hand × average cost · click a warehouse for its item detail
            </span>
          </div>
          {d.warehouses.filter((w) => w.units !== 0).length === 0 ? (
            <EmptyState message="No stock on hand at any warehouse." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-muted text-left">
                  <tr className="border-b border-border">
                    <th className="px-4 py-2 font-medium">Warehouse</th>
                    <th className="px-4 py-2 font-medium text-right">Units</th>
                    <th className="px-4 py-2 font-medium text-right">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {d.warehouses
                    .filter((w) => w.units !== 0)
                    .map((w) => (
                      <tr key={w.warehouseId} className="border-b border-border/50 hover:bg-surface-2/40">
                        <td className="px-4 py-2">
                          <Link
                            href={`/inventory?wh=${w.warehouseId}`}
                            className="hover:text-ember hover:underline flex items-center gap-2 flex-wrap"
                          >
                            <span>{w.name}</span>
                            <span className="badge font-mono text-muted">{w.code}</span>
                            {w.isDefaultWarehouse && <span className="badge text-teal">default</span>}
                          </Link>
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums text-muted">
                          {w.units.toLocaleString()}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums font-semibold">
                          {usd0(w.valueCents)}
                        </td>
                      </tr>
                    ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-border font-semibold">
                    <td className="px-4 py-2">Total</td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {d.warehouses.reduce((s, w) => s + w.units, 0).toLocaleString()}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">{usd0(d.valueCents)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Top movers -------------------------------------------------- */}
        <div className="card overflow-hidden">
          <div className="p-4 border-b border-border flex items-center gap-3">
            <h2 className="font-semibold">Top movers</h2>
            <span className="text-xs text-muted ml-auto">units shipped · last {MOVERS_WINDOW_DAYS}d</span>
          </div>
          {d.movers.length === 0 ? (
            <EmptyState message={`Nothing has shipped in the last ${MOVERS_WINDOW_DAYS} days.`} />
          ) : (
            <ul className="divide-y divide-border/50">
              {d.movers.map((m) => (
                <li key={m.productId} className="px-4 py-2">
                  <div className="flex items-center gap-3 text-sm">
                    <Link href={`/inventory/${m.productId}`} className="font-mono text-xs hover:text-ember hover:underline truncate max-w-[45%]">
                      {m.sku}
                    </Link>
                    <span className="text-muted truncate flex-1">{m.name}</span>
                    <span className="font-semibold tabular-nums">{m.unitsOut}</span>
                  </div>
                  <div className="mt-1 h-1.5 rounded-full bg-surface-2 overflow-hidden">
                    <div
                      className="h-full bg-ember"
                      style={{ width: `${d.maxMover ? (m.unitsOut / d.maxMover) * 100 : 0}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Aging ------------------------------------------------------- */}
        <div className="card overflow-hidden">
          <div className="p-4 border-b border-border flex items-center gap-3">
            <h2 className="font-semibold">Aging stock</h2>
            <span className="text-xs text-muted ml-auto">no movement in {AGING_DAYS}+ days</span>
          </div>
          {d.aging.length === 0 ? (
            <EmptyState message={`Nothing on hand has been static for ${AGING_DAYS}+ days.`} />
          ) : (
            <table className="w-full text-sm">
              <thead className="text-muted text-left">
                <tr className="border-b border-border">
                  <th className="px-4 py-2 font-medium">Item</th>
                  <th className="px-4 py-2 font-medium text-right">On hand</th>
                  <th className="px-4 py-2 font-medium text-right">Last moved</th>
                </tr>
              </thead>
              <tbody>
                {d.aging.map((x) => (
                  <tr key={x.id} className="border-b border-border/50">
                    <td className="px-4 py-2">
                      <Link href={`/inventory/${x.id}`} className="font-mono text-xs hover:text-ember hover:underline">
                        {x.sku}
                      </Link>
                      <div className="text-xs text-muted truncate">{x.name}</div>
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums font-semibold">{x.qty}</td>
                    <td className="px-4 py-2 text-right text-muted tabular-nums">{x.days}d</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Exceptions --------------------------------------------------- */}
      <div>
        <h2 className="text-sm font-mono uppercase tracking-widest text-muted mb-3">Exceptions</h2>
        <div className="grid lg:grid-cols-3 gap-6">
          <ExceptionCard
            title="Negative on-hand"
            hint="Data errors worth correcting — a slot can never truly be below zero."
            rows={d.negatives}
            emptyMessage="No negative balances."
          />
          <ExceptionCard
            title="Below max"
            hint="On hand under the replenishment ceiling — biggest gap first."
            rows={d.belowMax}
            emptyMessage="Everything with a max is stocked to it."
            footer={d.belowMaxExtra ? `+${d.belowMaxExtra} more` : undefined}
          />
          <ExceptionCard
            title="Show goods on hand"
            hint="Open-box stock to move first on show orders."
            rows={d.showGoodHolders}
            emptyMessage="No show-good stock on hand."
            footer={d.showGoodExtra ? `+${d.showGoodExtra} more` : undefined}
          />
        </div>
      </div>
    </div>
  );
}

function ExceptionCard({
  title,
  hint,
  rows,
  emptyMessage,
  footer,
}: {
  title: string;
  hint: string;
  rows: ExceptionRow[];
  emptyMessage: string;
  footer?: string;
}) {
  return (
    <div className="card overflow-hidden">
      <div className="p-4 border-b border-border">
        <div className="flex items-center gap-2">
          <h3 className="font-semibold">{title}</h3>
          <span className="badge">{rows.length}</span>
        </div>
        <p className="text-xs text-muted mt-1">{hint}</p>
      </div>
      {rows.length === 0 ? (
        <p className="px-4 py-6 text-sm text-muted text-center">{emptyMessage}</p>
      ) : (
        <ul className="divide-y divide-border/50">
          {rows.map((r) => (
            <li key={r.id} className="px-4 py-2 flex items-center gap-3 text-sm">
              <Link href={`/inventory/${r.id}`} className="font-mono text-xs hover:text-ember hover:underline truncate max-w-[45%]">
                {r.sku}
              </Link>
              <span className="text-muted truncate flex-1">{r.name}</span>
              <span
                className={`font-semibold tabular-nums ${
                  r.danger ? "text-danger" : r.showgood ? "text-showgood" : ""
                }`}
              >
                {r.value}
              </span>
            </li>
          ))}
        </ul>
      )}
      {footer && <div className="px-4 py-2 text-xs text-muted border-t border-border/50">{footer}</div>}
    </div>
  );
}
