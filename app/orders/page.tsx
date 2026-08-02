import Link from "next/link";
import { getViewer } from "@/lib/permissions/engine";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import type { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";

const STATUS_TONE: Record<string, string> = {
  DRAFT: "text-muted",
  CONFIRMED: "text-success",
  CANCELLED: "text-danger",
  SCHEDULED: "text-ember",
  STAGED: "text-ember",
  SHIPPED: "text-teal",
  DELIVERED: "text-teal",
};

function money(cents: number | null): string {
  if (cents == null) return "—";
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function orderDate(d: Date | null): string {
  if (!d) return "—";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ fraud?: string; q?: string }>;
}) {
  const { fraud, q } = await searchParams;
  const onlyFraud = fraud === "1";
  const query = (q ?? "").trim();
  const user = await getViewer();
  const canEnter = can(user, "orders:edit");

  // Match the order number and every whitespace-separated name token, so
  // "SO54356", "Bruscella", "Mark", and "Mark Bruscella" all find the order.
  const tokens = query.split(/\s+/).filter(Boolean).slice(0, 5);
  const where: Prisma.OrderWhereInput = {
    // Historical/analytics orders (the closed-sales backfill) never show in the
    // operational order book — only sales dashboards count them.
    isHistorical: false,
    ...(onlyFraud ? { fraudCheckStatus: "REQUIRED" } : {}),
    ...(tokens.length
      ? {
          AND: tokens.map((t) => ({
            OR: [
              { orderNo: { contains: t, mode: "insensitive" as const } },
              { posOrderNo: { contains: t, mode: "insensitive" as const } },
              { netsuiteOrderNo: { contains: t, mode: "insensitive" as const } },
              { customerFirst: { contains: t, mode: "insensitive" as const } },
              { customerLast: { contains: t, mode: "insensitive" as const } },
            ],
          })),
        }
      : {}),
  };

  const [orders, fraudWaiting] = await Promise.all([
    prisma.order.findMany({
      where,
      orderBy: [{ purchasedAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
      take: 100,
      include: {
        _count: { select: { islands: true, lines: true } },
        lines: { where: { productId: null }, select: { id: true } },
      },
    }),
    prisma.order.count({ where: { fraudCheckStatus: "REQUIRED" } }),
  ]);

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 space-y-8">
      <div className="flex items-start gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Orders</h1>
          <p className="text-muted mt-1">
            What the customer bought. An agreement or a configurator link decodes
            straight into island configurations, base and top SKUs, and the items
            to pick.
          </p>
        </div>
        <div className="ml-auto flex gap-2">
          <Link href="/orders/catalogue" className="btn btn-ghost">
            Catalogue
          </Link>
          {canEnter && (
            <Link href="/orders/new" className="btn btn-primary">
              New order
            </Link>
          )}
        </div>
      </div>

      <form method="get" className="flex gap-2">
        <input
          type="search"
          name="q"
          defaultValue={query}
          placeholder="Search by order number or customer name…"
          className="input flex-1"
          autoFocus
        />
        {onlyFraud && <input type="hidden" name="fraud" value="1" />}
        <button className="btn btn-primary" type="submit">
          Search
        </button>
        {query && (
          <Link href={onlyFraud ? "/orders?fraud=1" : "/orders"} className="btn btn-ghost">
            Clear
          </Link>
        )}
      </form>

      {fraudWaiting > 0 && (
        <Link
          href={onlyFraud ? "/orders" : "/orders?fraud=1"}
          className="card p-4 flex items-center gap-3 flex-wrap hover:border-ember/60 transition-colors"
        >
          <span className="badge text-danger">{fraudWaiting}</span>
          <span className="text-sm">
            {fraudWaiting === 1 ? "order is" : "orders are"} waiting on a manual fraud
            check — the billing address is not the delivery address.
          </span>
          <span className="ml-auto text-sm text-muted">
            {onlyFraud ? "Show all orders →" : "Show them →"}
          </span>
        </Link>
      )}

      <div className="card overflow-hidden">
        <div className="p-4 border-b border-border flex items-center gap-3">
          <h2 className="font-semibold">
            {query ? `Results for “${query}”` : onlyFraud ? "Awaiting fraud check" : "Recent"}
          </h2>
          <span className="badge text-muted">{orders.length}{orders.length === 100 ? "+" : ""}</span>
        </div>

        {orders.length === 0 ? (
          <div className="p-10 text-center text-muted">
            {query ? `No orders match “${query}”.` : "No orders yet."}
            {!query && canEnter && (
              <>
                {" "}
                <Link href="/orders/new" className="underline">
                  Enter the first one
                </Link>
                .
              </>
            )}
          </div>
        ) : (
          <ul className="divide-y divide-border/60">
            {orders.map((o) => {
              const unmatched = o.lines.length;
              const name = [o.customerFirst, o.customerLast].filter(Boolean).join(" ");
              return (
                <li key={o.id}>
                  <Link
                    href={`/orders/${o.id}`}
                    className="flex items-center gap-3 px-4 py-3 flex-wrap hover:bg-surface-2"
                  >
                    <span className="font-mono text-sm">{o.orderNo}</span>
                    <span className={`badge ${STATUS_TONE[o.status] ?? "text-muted"}`}>
                      {o.status}
                    </span>
                    {name && <span className="text-sm">{name}</span>}
                    {o.fraudCheckStatus === "REQUIRED" && (
                      <span className="badge text-danger">fraud check</span>
                    )}
                    {o.paidInFullOnePercent && (
                      <span className="badge text-success" title="Rep earns an extra 1%">
                        PIF 1%
                      </span>
                    )}
                    {o.gallery && (
                      <span className="text-xs text-muted hidden sm:inline">{o.gallery}</span>
                    )}
                    <span className="ml-auto flex items-center gap-3 text-xs text-muted">
                      <span className="tabular-nums" title="Order date">
                        {orderDate(o.purchasedAt ?? o.createdAt)}
                      </span>
                      {o._count.islands > 0 && (
                        <span>
                          {o._count.islands} island{o._count.islands === 1 ? "" : "s"}
                        </span>
                      )}
                      <span>{o._count.lines} lines</span>
                      {unmatched > 0 && (
                        <span className="badge text-danger">{unmatched} unmatched</span>
                      )}
                      <span className="tabular-nums hidden sm:inline">
                        {money(o.totalCents)}
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
