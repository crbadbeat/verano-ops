import Link from "next/link";
import { notFound } from "next/navigation";
import { getViewer } from "@/lib/permissions/engine";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import SkuDatalist from "@/components/SkuDatalist";
import { onHandByProduct } from "@/lib/inventory";
import { getOrderDetail } from "@/lib/orders";
import { getMinDepositBps } from "@/lib/settings";
import { depositGate } from "@/lib/deposit";
import { decodeSku } from "@/lib/sku";
import { getGrammar } from "@/lib/sku-grammar";
import { productDisplayName } from "@/lib/item-master";
import AddendumUpload from "@/components/orders/AddendumUpload";
import DeleteOrder from "@/components/orders/DeleteOrder";
import PaymentsPanel from "@/components/orders/PaymentsPanel";
import {
  addOrderLine,
  applyAddendum,
  deleteOrder,
  mapOrderLineToProduct,
  removeOrderLine,
  resolveFraudCheck,
  setOrderFlags,
  setOrderLineQty,
  setOrderStatus,
  syncSingleNetsuiteOrder,
  updateOrderHeader,
} from "../actions";

export const dynamic = "force-dynamic";

// Applying an addendum re-reads the agreement and rewrites the configuration,
// which outlasts the default serverless budget on a large order.
export const maxDuration = 60;

function money(cents: number | null): string {
  if (cents == null) return "—";
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

const ORIGIN_LABEL: Record<string, string> = {
  CONFIG_BASE: "Base",
  CONFIG_TOP: "Glass top",
  CONFIG_ITEM: "Configured",
  COMBO_BOM: "Shade kit",
  MANUAL: "Added by hand",
};

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await getViewer();
  const canEdit = can(user, "orders:edit");
  const canManage = can(user, "orders:manage");

  const order = await getOrderDetail(id);
  if (!order) notFound();

  const isNetsuite = order.source === "NETSUITE";
  const productTotalCents =
    order.totalCents != null ? order.totalCents - (order.salesTaxCents ?? 0) - (order.freightCents ?? 0) : null;
  const minDepositBps = isNetsuite ? await getMinDepositBps() : 0;
  const depGate = depositGate(order.depositReceivedCents, order.totalCents, minDepositBps);
  const depositUnverified = order.depositReceivedCents == null && (order.customerOpenOrderCount ?? 0) > 1;
  const pctDown = depGate.pctBps != null ? Math.floor(depGate.pctBps / 100) : 0;

  const blankSkus = order.islands.map((i) => i.topBlankSku).filter((s): s is string => !!s);
  const [onHand, blanks, skus] = await Promise.all([
    onHandByProduct(),
    blankSkus.length
      ? prisma.product.findMany({
          where: { sku: { in: blankSkus } },
          select: { id: true, sku: true },
        })
      : Promise.resolve([]),
    prisma.product.findMany({
      where: { active: true },
      select: { sku: true, displayName: true, name: true },
      orderBy: { sku: "asc" },
    }),
  ]);
  const blankBySku = new Map(blanks.map((b) => [b.sku, b]));

  const unmatched = order.lines.filter((l) => !l.productId);
  const customer = [order.customerFirst, order.customerLast].filter(Boolean).join(" ");

  // Some products are sold and shipped as part of the base — an outlet is
  // pre-wired into the island — so they belong on the order but never on the
  // pick list. That is `Product.pickable`, editable on the product itself.
  const toPick = order.lines.filter((l) => l.product?.pickable !== false);
  const included = order.lines.filter((l) => l.product?.pickable === false);

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 space-y-8">
      <SkuDatalist id="all-skus" products={skus} />

      {/* ---- header ---- */}
      <div>
        <Link href="/orders" className="text-sm text-muted hover:underline">
          ← Orders
        </Link>
        <div className="flex items-center gap-x-4 gap-y-2 flex-wrap mt-2">
          <h1 className="text-2xl font-bold tracking-tight font-mono text-muted">{order.orderNo}</h1>
          {customer && <span className="text-3xl font-bold tracking-tight">{customer}</span>}
          <span className="badge">{order.status}</span>
          <span className="badge text-muted">{order.source.replace("_", " ")}</span>
          <div className="ml-auto flex gap-2">
            {order.source === "NETSUITE" && canManage && (
              <form action={syncSingleNetsuiteOrder}>
                <input type="hidden" name="orderId" value={order.id} />
                <button className="btn btn-ghost py-1.5 px-3 text-sm" type="submit">
                  Sync from NetSuite
                </button>
              </form>
            )}
            {canEdit && order.status !== "CANCELLED" && (
              <form action={setOrderStatus} className="flex gap-2">
                <input type="hidden" name="orderId" value={order.id} />
                <input
                  type="hidden"
                  name="status"
                  value={order.status === "CONFIRMED" ? "DRAFT" : "CONFIRMED"}
                />
                <button className="btn btn-primary py-1.5 px-3 text-sm" type="submit">
                  {order.status === "CONFIRMED" ? "Back to draft" : "Confirm order"}
                </button>
              </form>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="card p-5 space-y-1 text-sm">
          <h3 className="font-semibold mb-2">Customer</h3>
          <Field label="Email" value={order.email} />
          <Field label="Phone" value={order.phone} />
          <Field
            label="Deliver to"
            value={[
              order.deliveryAddress,
              [order.deliveryCity, order.deliveryState].filter(Boolean).join(", "),
              order.deliveryZip,
            ]
              .filter(Boolean)
              .join(" · ")}
          />
          <Field
            label="Bill to"
            value={[
              order.billingAddress,
              [order.billingCity, order.billingState].filter(Boolean).join(", "),
              order.billingZip,
            ]
              .filter(Boolean)
              .join(" · ")}
          />
          <Field label="Gallery" value={order.gallery} />
          {isNetsuite ? (
            <>
              <Field label="1st Sales Rep" value={order.salesRep1Id} />
              <Field label="2nd Sales Rep" value={order.salesRep2Id} />
              <Field label="GTL" value={order.gtlId} />
              <Field label="Regional" value={order.regionalId} />
              <Field label="VP" value={order.vpId} />
            </>
          ) : (
            <>
              <Field label="Sales rep" value={order.salesRepName} />
              <Field label="GTL / REP id" value={[order.gtlId, order.repId].filter(Boolean).join(" / ")} />
            </>
          )}
          <Field label="Requested" value={order.requestedTimeframe} />
        </div>

        <div className="card p-5 space-y-1 text-sm">
          <h3 className="font-semibold mb-2">Sale</h3>
          {isNetsuite ? (
            <>
              <Field label="Product total" value={productTotalCents != null ? money(productTotalCents) : null} />
              <Field label="Delivery / freight" value={money(order.freightCents)} />
              <Field label="Sales tax" value={money(order.salesTaxCents)} />
              <Field label="Order total" value={money(order.orderTotalCents ?? order.totalCents)} />
              <Field
                label="Deposit"
                value={
                  depositUnverified
                    ? `${money(order.depositUnverifiedCents)} — unverified (customer has ${order.customerOpenOrderCount} open orders)`
                    : order.depositReceivedCents == null
                      ? "—"
                      : `${money(order.depositReceivedCents)} · ${pctDown}% down${depGate.met ? "" : " · under"}`
                }
              />
            </>
          ) : (
            <>
              <Field label="Order total" value={money(order.orderTotalCents ?? order.totalCents)} />
              <Field label="Sales tax" value={money(order.salesTaxCents)} />
              <Field label="Delivery / freight" value={money(order.freightCents)} />
              <Field label="Total purchase price" value={money(order.totalCents)} />
              <Field label="Down payment (printed)" value={money(order.downPaymentCents)} />
              <Field label="Balance due (printed)" value={money(order.balanceDueCents)} />
            </>
          )}
          {canEdit && !isNetsuite && (
            <form action={updateOrderHeader} className="mt-3 flex gap-2">
              <input type="hidden" name="orderId" value={order.id} />
              <input
                name="netsuiteOrderNo"
                defaultValue={order.netsuiteOrderNo ?? ""}
                placeholder="NetSuite order # (for invoicing)"
                className="input text-sm"
              />
              <button className="btn btn-ghost py-1 px-3 text-sm" type="submit">
                Save
              </button>
            </form>
          )}
        </div>
      </div>

      {/* ---- fraud check ---- */}
      {order.fraudCheckStatus !== "NOT_REQUIRED" && (
        <div
          className={`card p-5 ${
            order.fraudCheckStatus === "REQUIRED" ? "border-danger/50" : ""
          }`}
        >
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-semibold">Fraud check</h3>
            <span
              className={`badge ${
                order.fraudCheckStatus === "CLEARED"
                  ? "text-success"
                  : order.fraudCheckStatus === "REJECTED"
                    ? "text-danger"
                    : "text-ember"
              }`}
            >
              {order.fraudCheckStatus}
            </span>
          </div>
          <p className="text-sm text-muted mt-1">
            The billing address is not the delivery address, so this order needs a
            manual check before it is worked.
          </p>
          {order.fraudCheckNote && (
            <p className="text-sm mt-2">{order.fraudCheckNote}</p>
          )}
          {can(user, "orders:approve") && (
            <form action={resolveFraudCheck} className="mt-3 flex gap-2 flex-wrap">
              <input type="hidden" name="orderId" value={order.id} />
              <input
                name="fraudCheckNote"
                defaultValue={order.fraudCheckNote ?? ""}
                placeholder="What was checked"
                className="input text-sm flex-1 min-w-48"
              />
              <button
                className="btn btn-primary py-1 px-3 text-sm"
                name="status"
                value="CLEARED"
                type="submit"
              >
                Clear
              </button>
              <button
                className="btn btn-ghost py-1 px-3 text-sm text-danger"
                name="status"
                value="REJECTED"
                type="submit"
              >
                Reject
              </button>
            </form>
          )}
        </div>
      )}

      {/* ---- payments (manual entry only for non-NetSuite orders; for synced
             orders the deposit comes from NetSuite and shows in the Sale card) ---- */}
      {!isNetsuite && (
        <PaymentsPanel
          orderId={order.id}
          payments={order.payments}
          totalCents={order.totalCents}
          printedDownPaymentCents={order.downPaymentCents}
          paidInFullOnePercent={order.paidInFullOnePercent}
          paidInFullConfirmedAt={order.paidInFullConfirmedAt}
          canEdit={canEdit}
        />
      )}

      {/* ---- commercial flags (hidden for NetSuite orders — fuel type and the
             rest are determined in NetSuite, the source of truth) ---- */}
      {!isNetsuite && (
      <div className="card p-5">
        <h3 className="font-semibold">Order flags</h3>
        <p className="text-sm text-muted mt-1">
          The fuel type is not something we ship — it selects the LP or NG variant
          of every gas appliance on the order.
        </p>
        <form action={setOrderFlags} className="mt-3 flex items-center gap-4 flex-wrap text-sm">
          <input type="hidden" name="orderId" value={order.id} />
          <label className="flex items-center gap-2">
            <span className="text-muted">Fuel type</span>
            <select
              name="gasType"
              defaultValue={order.gasType ?? ""}
              disabled={!canEdit}
              className="input text-sm py-1"
            >
              <option value="">Not stated</option>
              <option value="LP">Liquid propane</option>
              <option value="NG">Natural gas</option>
            </select>
          </label>
          <Check name="taxFree" label="Sold tax free" checked={order.taxFree} disabled={!canEdit} />
          <Check
            name="freightInTotal"
            label="Freight in total"
            checked={order.freightInTotal}
            disabled={!canEdit}
          />
          <Check
            name="veranoForLife"
            label={`Verano For Life${order.veranoForLifeTier ? ` (${order.veranoForLifeTier})` : ""}`}
            checked={order.veranoForLife}
            disabled={!canEdit}
          />
          {canEdit && (
            <button className="btn btn-ghost py-1 px-3 text-sm ml-auto" type="submit">
              Save flags
            </button>
          )}
        </form>
      </div>
      )}

      {/* ---- islands ---- */}
      {order.islands.length > 0 && (
        <div className="space-y-4">
          <h2 className="font-semibold text-lg">Islands</h2>
          {order.islands.map((island) => {
            const attrs = (island.attributes ?? {}) as Record<string, string>;
            const blank = island.topBlankSku ? blankBySku.get(island.topBlankSku) : null;
            const blankOnHand = blank ? onHand.get(blank.id) ?? 0 : 0;
            const topOnHand = island.topProductId ? onHand.get(island.topProductId) ?? 0 : 0;
            const baseOnHand = island.baseProductId ? onHand.get(island.baseProductId) ?? 0 : 0;

            return (
              <div key={island.id} className="card p-5 space-y-4">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="badge text-ember">
                    {island.role === "GRILL" ? "Grill island" : "Bar island"}
                  </span>
                  <span className="font-semibold">{island.styleCode}</span>
                  {island.grillPosition && (
                    <span className="text-sm text-muted">({island.grillPosition})</span>
                  )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <SkuCard
                    title="Base"
                    sku={island.baseSku}
                    onHandQty={baseOnHand}
                    linked={island.baseProduct?.netsuiteLinkedAt != null}
                    category="Base"
                  />
                  <SkuCard
                    title="Glass top"
                    sku={island.topSku}
                    onHandQty={topOnHand}
                    linked={island.topProduct?.netsuiteLinkedAt != null}
                    category="Glass"
                    footer={
                      island.topBlankSku ? (
                        <p className="text-xs text-muted mt-2">
                          Cut from{" "}
                          <span className="font-mono">{island.topBlankSku}</span> —{" "}
                          {blank ? (
                            <span className={blankOnHand > 0 ? "text-success" : "text-danger"}>
                              {blankOnHand} blank{blankOnHand === 1 ? "" : "s"} on hand
                            </span>
                          ) : (
                            <span className="text-danger">that blank is not a product here</span>
                          )}
                          . Not queued for cutting — glass waits until the customer
                          is scheduled.
                        </p>
                      ) : null
                    }
                  />
                </div>

                <details className="text-sm">
                  <summary className="cursor-pointer text-muted">Configuration</summary>
                  <dl className="mt-2 grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1">
                    {Object.entries(attrs)
                      .filter(([k]) => k !== "grillHoleXl")
                      .map(([k, v]) => (
                        <div key={k} className="flex justify-between gap-2">
                          <dt className="text-muted">{k}</dt>
                          <dd className="font-mono text-xs">{String(v)}</dd>
                        </div>
                      ))}
                  </dl>
                </details>
              </div>
            );
          })}
        </div>
      )}

      {/* ---- unmatched (FSA/manual orders only — NetSuite orders carry the item's
             display name for picking; no manual matching needed) ---- */}
      {!isNetsuite && unmatched.length > 0 && (
        <div className="card overflow-hidden border-danger/40">
          <div className="p-4 border-b border-border flex items-center gap-3">
            <h2 className="font-semibold">Needs mapping</h2>
            <span className="badge text-danger">{unmatched.length}</span>
          </div>
          <p className="px-4 pt-3 text-sm text-muted">
            These items have no product yet. Mapping one is remembered, so the next
            order that words it the same way resolves on its own.
          </p>
          <ul className="divide-y divide-border/60 mt-2">
            {unmatched.map((line) => (
              <li key={line.id} className="px-4 py-3 flex items-center gap-2 flex-wrap">
                <span className="text-sm">{line.rawLabel ?? line.sku}</span>
                <span className="text-xs text-muted">×{line.qty}</span>
                {canEdit && (
                  <form action={mapOrderLineToProduct} className="ml-auto flex gap-2">
                    <input type="hidden" name="lineId" value={line.id} />
                    <input
                      name="sku"
                      list="all-skus"
                      required
                      placeholder="Map to SKU"
                      className="input font-mono text-sm py-1"
                    />
                    <button className="btn btn-ghost py-1 px-3 text-sm" type="submit">
                      Map
                    </button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ---- lines ---- */}
      <div className="card overflow-hidden">
        <div className="p-4 border-b border-border flex items-center gap-3">
          <h2 className="font-semibold">Items to pick</h2>
          <span className="badge text-muted">{toPick.length}</span>
        </div>
        <ul className="divide-y divide-border/60">
          {toPick.map((line) => (
            <li key={line.id} className="px-4 py-2.5 flex items-center gap-3 flex-wrap text-sm">
              <span className="badge text-muted text-xs">
                {order.source === "NETSUITE" ? "NetSuite" : ORIGIN_LABEL[line.origin]}
              </span>
              <span>{line.product ? productDisplayName(line.product) : line.rawLabel ?? line.sku}</span>
              {line.product && (
                <Link
                  href={`/inventory/${line.product.id}`}
                  className="font-mono text-xs text-muted hover:underline"
                >
                  {line.product.sku}
                </Link>
              )}
              {!line.productId && <span className="badge text-danger text-xs">unmatched</span>}
              <span className="ml-auto flex items-center gap-2">
                {canEdit && !isNetsuite ? (
                  <form action={setOrderLineQty} className="flex items-center gap-1">
                    <input type="hidden" name="lineId" value={line.id} />
                    <input
                      name="qty"
                      type="number"
                      min={0}
                      defaultValue={line.qty}
                      className="input w-20 py-1 text-sm tabular-nums"
                      aria-label="Quantity"
                    />
                    <button className="btn btn-ghost py-1 px-2 text-xs" type="submit">
                      Set
                    </button>
                  </form>
                ) : (
                  <span className="tabular-nums">×{line.qty}</span>
                )}
                {canEdit && !isNetsuite && (
                  <form action={removeOrderLine}>
                    <input type="hidden" name="lineId" value={line.id} />
                    <button className="btn btn-ghost py-1 px-2 text-xs text-danger" type="submit">
                      Remove
                    </button>
                  </form>
                )}
              </span>
            </li>
          ))}
        </ul>
        {canEdit && !isNetsuite && (
          <form action={addOrderLine} className="p-4 border-t border-border flex gap-2 flex-wrap">
            <input type="hidden" name="orderId" value={order.id} />
            <input
              name="sku"
              list="all-skus"
              required
              placeholder="Add an item by SKU"
              className="input font-mono text-sm flex-1 min-w-48"
            />
            <input
              name="qty"
              type="number"
              min={1}
              defaultValue={1}
              className="input w-24 text-sm"
              aria-label="Quantity"
            />
            <button className="btn btn-ghost text-sm" type="submit">
              Add line
            </button>
          </form>
        )}
      </div>

      {/* ---- sold, but part of the base ---- */}
      {included.length > 0 && (
        <div className="card overflow-hidden">
          <div className="p-4 border-b border-border flex items-center gap-3 flex-wrap">
            <h2 className="font-semibold">Included — not picked</h2>
            <span className="badge text-muted">{included.length}</span>
            <span className="text-xs text-muted ml-auto">
              Part of the base. Change this on the product itself.
            </span>
          </div>
          <ul className="divide-y divide-border/60">
            {included.map((line) => (
              <li
                key={line.id}
                className="px-4 py-2.5 flex items-center gap-3 flex-wrap text-sm text-muted"
              >
                <span>{line.product ? productDisplayName(line.product) : line.rawLabel}</span>
                {line.product && (
                  <Link
                    href={`/inventory/${line.product.id}`}
                    className="font-mono text-xs hover:underline"
                  >
                    {line.product.sku}
                  </Link>
                )}
                <span className="ml-auto tabular-nums">×{line.qty}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ---- addendum (FSA/configurator orders only; NetSuite is the source of
             truth for synced orders, use "Sync from NetSuite" instead) ---- */}
      {canEdit && order.source !== "NETSUITE" && (
        <AddendumUpload orderId={order.id} action={applyAddendum} />
      )}

      {/* ---- documents ---- */}
      {order.documents.length > 0 && (
        <div className="card overflow-hidden">
          <div className="p-4 border-b border-border">
            <h2 className="font-semibold">Documents</h2>
          </div>
          <ul className="divide-y divide-border/60">
            {order.documents.map((d) => (
              <li key={d.id} className="px-4 py-2.5 flex items-center gap-3 text-sm flex-wrap">
                <span className="badge text-muted text-xs">{d.kind}</span>
                <span>{d.filename}</span>
                <span className="ml-auto text-xs text-muted">
                  {d.uploadedAt.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ---- delete (not for NetSuite orders — NetSuite is the source of truth;
             fix or cancel at the source, then Sync from NetSuite) ---- */}
      {canEdit && !isNetsuite && (
        <div className="flex justify-end">
          <DeleteOrder
            orderId={order.id}
            orderNo={order.orderNo}
            counts={{
              islands: order.islands.length,
              lines: order.lines.length,
              payments: order.payments.length,
              documents: order.documents.length,
            }}
            action={deleteOrder}
          />
        </div>
      )}

      {/* ---- activity ---- */}
      <div className="card overflow-hidden">
        <div className="p-4 border-b border-border">
          <h2 className="font-semibold">Activity</h2>
        </div>
        <ul className="divide-y divide-border/60">
          {order.events.map((e) => (
            <li key={e.id} className="px-4 py-2.5 text-sm">
              <div className="flex items-center gap-3 flex-wrap">
                <span>{e.summary}</span>
                <span className="ml-auto text-xs text-muted">
                  {e.user?.email ?? "system"} ·{" "}
                  {e.createdAt.toLocaleString("en-US", {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </span>
              </div>
              <EventDetail detail={e.detail} />
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function Check({
  name,
  label,
  checked,
  disabled,
}: {
  name: string;
  label: string;
  checked: boolean;
  disabled: boolean;
}) {
  return (
    <label className="flex items-center gap-2">
      <input
        type="checkbox"
        name={name}
        defaultChecked={checked}
        disabled={disabled}
        className="h-4 w-4 accent-[var(--ember)]"
      />
      <span>{label}</span>
    </label>
  );
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div className="flex justify-between gap-3">
      <span className="text-muted">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );
}

function SkuCard({
  title,
  sku,
  onHandQty,
  linked,
  category,
  footer,
}: {
  title: string;
  sku: string | null;
  onHandQty: number;
  linked: boolean;
  category: string;
  footer?: React.ReactNode;
}) {
  if (!sku) {
    return (
      <div className="rounded-lg border border-border p-3">
        <p className="text-xs text-muted">{title}</p>
        <p className="text-sm text-muted mt-1">Not composed.</p>
      </div>
    );
  }
  const decoded = decodeSku(sku, getGrammar(category));
  return (
    <div className="rounded-lg border border-border p-3">
      <div className="flex items-center gap-2 flex-wrap">
        <p className="text-xs text-muted">{title}</p>
        <span className={`ml-auto text-xs ${onHandQty > 0 ? "text-success" : "text-danger"}`}>
          {onHandQty} on hand
        </span>
      </div>
      <p className="font-mono text-sm mt-1 break-all">{sku}</p>
      <p className="text-xs text-muted mt-1">{decoded.label}</p>
      {!linked && (
        <span className="badge text-ember text-xs mt-2 inline-block">
          awaiting NetSuite match
        </span>
      )}
      {footer}
    </div>
  );
}

/** Addendum events carry the before/after diff; render it inline. */
function EventDetail({ detail }: { detail: unknown }) {
  if (!detail || typeof detail !== "object") return null;
  const d = detail as { added?: string[]; removed?: string[]; warnings?: string[] };
  const has = (a?: string[]) => a && a.length > 0;
  if (!has(d.added) && !has(d.removed) && !has(d.warnings)) return null;

  return (
    <div className="mt-1 space-y-0.5 text-xs">
      {d.added?.map((a, i) => (
        <p key={`a${i}`} className="text-success">
          + {a}
        </p>
      ))}
      {d.removed?.map((r, i) => (
        <p key={`r${i}`} className="text-danger">
          − {r}
        </p>
      ))}
      {d.warnings?.map((w, i) => (
        <p key={`w${i}`} className="text-muted">
          ! {w}
        </p>
      ))}
    </div>
  );
}
