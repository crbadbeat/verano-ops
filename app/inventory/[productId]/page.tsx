import Link from "next/link";
import { getViewer } from "@/lib/permissions/engine";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";

import { can } from "@/lib/rbac";
import { decodeSku } from "@/lib/sku";
import { getGrammar } from "@/lib/sku-grammar";
import { productDisplayName } from "@/lib/item-master";
import {
  productStockByWarehouse,
  locationCostsForProduct,
  splitTotal,
  type StockSplit,
} from "@/lib/inventory";
import { getOverheadBps } from "@/lib/settings";
import { burdenedCost } from "@/lib/overhead";
import { defaultWarehouse } from "@/lib/locations";
import PageHeader from "@/components/ui/PageHeader";
import ProductMappingEditor from "@/components/inventory/ProductMappingEditor";
import PickAliasEditor from "@/components/inventory/PickAliasEditor";
import AdjustStockForm from "@/components/inventory/AdjustStockForm";

export const dynamic = "force-dynamic";

// Reasons that describe stock arriving vs leaving, for at-a-glance colouring.
const REASON_LABEL: Record<string, string> = {
  SEED: "seed",
  ADJUSTMENT: "adjustment",
  SHIPMENT: "shipment",
  REVERSAL: "reversal",
  COUNT: "count",
  TRANSFER_OUT: "transfer out",
  TRANSFER_IN: "transfer in",
  MANUFACTURE: "built",
  CONSUME: "consumed",
  RETURN: "return",
  MOD_OUT: "mod out",
  MOD_IN: "mod in",
  PICK: "picked",
};

const BUILD_LABEL: Record<string, string> = {
  SPECIAL: "Special — built per order",
  PARENT: "Parent — stocked",
  CHILD: "Child — built from a parent",
};

type Row = Awaited<ReturnType<typeof loadRows>>[number];

async function loadRows(productId: string) {
  return prisma.inventoryLedger.findMany({
    where: { productId },
    orderBy: { createdAt: "desc" },
    take: 200,
    include: {
      location: { select: { code: true } },
      createdBy: { select: { email: true } },
      countSession: { select: { id: true, label: true } },
      manufacturingEntry: { select: { id: true, stage: true } },
      transfer: { select: { id: true, reference: true } },
      returnOrder: { select: { id: true, reference: true } },
      glassMod: { select: { id: true, orderNo: true } },
    },
  });
}

function sourceLink(r: Row): { href: string; label: string } | null {
  if (r.countSession)
    return { href: `/count/${r.countSession.id}`, label: r.countSession.label };
  if (r.manufacturingEntry)
    return { href: `/manufacturing/entries`, label: `Mfg — ${r.manufacturingEntry.stage}` };
  if (r.transfer)
    return { href: `/transfers/${r.transfer.id}`, label: r.transfer.reference ?? "Transfer" };
  if (r.returnOrder)
    return { href: `/returns/${r.returnOrder.id}`, label: r.returnOrder.reference ?? "Return" };
  if (r.glassMod)
    return {
      href: `/glass`,
      label: `Glass mod${r.glassMod.orderNo ? ` #${r.glassMod.orderNo}` : ""}`,
    };
  return null;
}

function usd(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function SplitBadges({ split }: { split: StockSplit }) {
  return (
    <span className="flex items-center gap-3 tabular-nums">
      <span>
        <span className="text-muted text-xs">new </span>
        {split.new}
      </span>
      {split.showGood !== 0 && (
        <span className="text-showgood">
          <span className="text-xs">SG </span>
          {split.showGood}
        </span>
      )}
      <span className="font-semibold">{splitTotal(split)}</span>
    </span>
  );
}

export default async function ItemDetailPage({
  params,
}: {
  params: Promise<{ productId: string }>;
}) {
  const { productId } = await params;

  const user = await getViewer();
  if (!can(user, "inventory:view")) notFound();
  const canManage = can(user, "catalog:edit");
  const canAdjust = can(user, "inventory:adjust");

  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product) notFound();

  // A product whose parent is itself is stocked in its own right, not built from
  // something else — that is how the lookup sheets express it.
  const builtFrom =
    product.parentSku && product.parentSku !== product.sku ? product.parentSku : null;

  const [warehouseStock, locationCosts, rows, aliases, warehouses, def, parent, children, overheadBps] =
    await Promise.all([
      productStockByWarehouse(productId),
      locationCostsForProduct(productId),
      loadRows(productId),
      prisma.pickAlias.findMany({
        where: { productId },
        orderBy: { createdAt: "asc" },
        select: { id: true, sourceItem: true, sourceDetail: true, category: true },
      }),
      prisma.location.findMany({
        where: { type: "WAREHOUSE" },
        orderBy: [{ isDefaultWarehouse: "desc" }, { name: "asc" }],
        select: { id: true, name: true, isDefaultWarehouse: true, overheadExempt: true },
      }),
      defaultWarehouse(),
      builtFrom
        ? prisma.product.findUnique({
            where: { sku: builtFrom },
            select: { id: true, sku: true },
          })
        : null,
      prisma.product.findMany({
        where: { parentSku: product.sku, NOT: { id: productId } },
        select: { id: true, sku: true },
        orderBy: { sku: "asc" },
      }),
      getOverheadBps(),
    ]);

  const exemptById = new Map(warehouses.map((w) => [w.id, w.overheadExempt]));
  const total = warehouseStock.reduce((s, w) => s + splitTotal(w.split), 0);
  const showGoodTotal = warehouseStock.reduce((s, w) => s + w.split.showGood, 0);

  // Human-readable config, once a smart-SKU grammar exists for this category.
  const decoded = decodeSku(product.sku, getGrammar(product.category));

  const defaultWarehouseId = def?.id ?? warehouses[0]?.id ?? "";

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 space-y-6">
      <Link href="/inventory" className="text-muted hover:text-foreground text-sm">
        ← Stock
      </Link>

      <PageHeader
        eyebrow={<span className="font-mono">{product.sku}</span>}
        title={productDisplayName(product)}
        description={
          <>
            {product.description ?? product.category ?? ""}
            {decoded.attributes.length > 0 && (
              <span className="block text-teal mt-1">{decoded.label}</span>
            )}
          </>
        }
        actions={
          <div className="text-right">
            <div className={`text-4xl font-bold tabular-nums ${total <= 0 ? "text-danger" : ""}`}>
              {total}
            </div>
            <div className="text-xs text-muted">on hand (all warehouses)</div>
            {showGoodTotal !== 0 && (
              <div className="text-xs text-showgood mt-1">incl. {showGoodTotal} show good</div>
            )}
          </div>
        }
      />

      <ProductMappingEditor
        product={{
          id: product.id,
          sku: product.sku,
          displayName: product.displayName,
          name: product.name,
          description: product.description,
          category: product.category,
          netsuiteNumber: product.netsuiteNumber,
          barcode: product.barcode,
          parentSku: product.parentSku,
          buildCategory: product.buildCategory,
          maxStockLevel: product.maxStockLevel,
          pickable: product.pickable,
          active: product.active,
        }}
        canManage={canManage}
      />

      {(product.buildCategory || builtFrom || children.length > 0) && (
        <div className="card p-4 space-y-2 text-sm">
          <h2 className="font-semibold">How it is built</h2>
          {product.buildCategory && (
            <div>
              <span className="text-muted">Category </span>
              <span className="badge">{BUILD_LABEL[product.buildCategory]}</span>
            </div>
          )}
          {builtFrom && (
            <div>
              <span className="text-muted">Built / cut from </span>
              {parent ? (
                <Link href={`/inventory/${parent.id}`} className="font-mono text-xs hover:text-ember hover:underline">
                  {parent.sku}
                </Link>
              ) : (
                <>
                  <span className="font-mono text-xs">{builtFrom}</span>
                  <span className="text-muted"> — not a product here yet</span>
                </>
              )}
            </div>
          )}
          {children.length > 0 && (
            <div>
              <span className="text-muted">Built / cut into ({children.length}) </span>
              <span className="flex flex-wrap gap-x-3 gap-y-1 mt-1">
                {children.map((c) => (
                  <Link key={c.id} href={`/inventory/${c.id}`} className="font-mono text-xs hover:text-ember hover:underline">
                    {c.sku}
                  </Link>
                ))}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Where it is — per-warehouse, rolled up from each bin. */}
      <div className="card overflow-hidden">
        <div className="p-4 border-b border-border">
          <h2 className="font-semibold">Where it is</h2>
        </div>
        {warehouseStock.length === 0 ? (
          <div className="p-8 text-center text-muted text-sm">No stock recorded anywhere.</div>
        ) : (
          <div className="divide-y divide-border/60">
            {warehouseStock.map((w) => (
              <div key={w.warehouseId} className="p-4 space-y-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold">{w.name}</span>
                  <span className="badge font-mono text-muted">{w.code}</span>
                  {w.isDefaultWarehouse && <span className="badge text-teal">default</span>}
                  <span className="ml-auto">
                    <SplitBadges split={w.split} />
                  </span>
                </div>
                {(() => {
                  const base = locationCosts.get(w.warehouseId);
                  if (base == null) return null;
                  const exempt = exemptById.get(w.warehouseId) ?? false;
                  const cost = burdenedCost(base, overheadBps, exempt);
                  return (
                    <div className="flex items-center gap-2 text-xs text-muted">
                      <span>
                        Avg cost{" "}
                        <span className="text-foreground font-medium">{usd(cost)}</span>
                        <span className="text-muted">
                          {" "}
                          (NetSuite{exempt ? "" : " + overhead"})
                        </span>
                      </span>
                      <span className="ml-auto">
                        Value{" "}
                        <span className="text-foreground font-medium tabular-nums">
                          {usd(splitTotal(w.split) * cost)}
                        </span>
                      </span>
                    </div>
                  );
                })()}
                <table className="w-full text-sm">
                  <tbody>
                    {w.slots.map((s, i) => (
                      <tr key={i} className="text-muted">
                        <td className="py-1">
                          {s.label}
                          {s.condition === "SHOW_GOOD" && (
                            <span className="badge text-showgood ml-2">show good</span>
                          )}
                        </td>
                        <td className={`py-1 text-right tabular-nums ${s.qty < 0 ? "text-danger" : ""}`}>
                          {s.qty}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        )}
      </div>

      {canAdjust && warehouses.length > 0 && (
        <AdjustStockForm
          productId={product.id}
          warehouses={warehouses}
          defaultWarehouseId={defaultWarehouseId}
        />
      )}

      <PickAliasEditor productId={product.id} aliases={aliases} canManage={canManage} />

      <div className="card overflow-hidden">
        <div className="p-4 border-b border-border flex items-center gap-3">
          <h2 className="font-semibold">Movement history</h2>
          <span className="badge">{rows.length}</span>
          <span className="text-xs text-muted ml-auto">newest first · max 200</span>
        </div>
        {rows.length === 0 ? (
          <div className="p-8 text-center text-muted text-sm">No movements yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-muted text-left">
                <tr className="border-b border-border">
                  <th className="px-4 py-2 font-medium">When</th>
                  <th className="px-4 py-2 font-medium">What</th>
                  <th className="px-4 py-2 font-medium text-right">Qty</th>
                  <th className="px-4 py-2 font-medium">Location</th>
                  <th className="px-4 py-2 font-medium">Source</th>
                  <th className="px-4 py-2 font-medium">By</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const src = sourceLink(r);
                  return (
                    <tr key={r.id} className="border-b border-border/50">
                      <td className="px-4 py-2 text-muted whitespace-nowrap">
                        {r.createdAt.toLocaleDateString("en-US", { dateStyle: "medium" })}
                      </td>
                      <td className="px-4 py-2">
                        <span className="badge">{REASON_LABEL[r.reason] ?? r.reason}</span>
                      </td>
                      <td
                        className={`px-4 py-2 text-right font-semibold tabular-nums ${
                          r.qtyDelta < 0 ? "text-danger" : "text-success"
                        }`}
                      >
                        {r.qtyDelta > 0 ? `+${r.qtyDelta}` : r.qtyDelta}
                      </td>
                      <td className="px-4 py-2 text-muted">
                        {r.location?.code ?? "warehouse"}
                        {r.condition === "SHOW_GOOD" && (
                          <span className="badge text-showgood ml-2">SG</span>
                        )}
                      </td>
                      <td className="px-4 py-2">
                        {src ? (
                          <Link href={src.href} className="text-ember hover:underline">
                            {src.label}
                          </Link>
                        ) : (
                          <span className="text-muted">{r.note ?? "—"}</span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-muted text-xs">{r.createdBy?.email ?? "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
