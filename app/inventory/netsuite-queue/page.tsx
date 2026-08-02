import Link from "next/link";
import { getViewer } from "@/lib/permissions/engine";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { decodeSku } from "@/lib/sku";
import { getGrammar } from "@/lib/sku-grammar";
import { linkProductToNetsuite } from "@/app/orders/actions";

export const dynamic = "force-dynamic";

export default async function NetsuiteQueuePage() {
  const user = await getViewer();
  const canLink = can(user, "catalog:edit");

  // Everything seeded from NetSuite was marked linked when the column was added,
  // so this queue is exactly the products order intake has created since.
  const pending = await prisma.product.findMany({
    where: { netsuiteLinkedAt: null },
    orderBy: { createdAt: "asc" },
    include: {
      orderLines: {
        select: { order: { select: { id: true, orderNo: true } } },
        take: 5,
      },
    },
  });

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 space-y-8">
      <div>
        <Link href="/inventory" className="text-sm text-muted hover:underline">
          ← Inventory
        </Link>
        <h1 className="text-3xl font-bold tracking-tight mt-2">NetSuite match queue</h1>
        <p className="text-muted mt-1">
          Configurations a customer ordered that nobody had stocked before. The hub
          created each one so the order could resolve; tie it to its NetSuite item
          to close the loop. Worth working daily.
        </p>
      </div>

      <div className="card overflow-hidden">
        <div className="p-4 border-b border-border flex items-center gap-3">
          <h2 className="font-semibold">Waiting</h2>
          <span className={`badge ${pending.length ? "text-ember" : "text-muted"}`}>
            {pending.length}
          </span>
        </div>

        {pending.length === 0 ? (
          <div className="p-10 text-center text-muted">
            Nothing waiting — every product is tied to NetSuite.
          </div>
        ) : (
          <ul className="divide-y divide-border/60">
            {pending.map((p) => {
              const decoded = decodeSku(p.sku, getGrammar(p.category));
              const orders = [
                ...new Map(p.orderLines.map((l) => [l.order.id, l.order])).values(),
              ];
              return (
                <li key={p.id} className="px-4 py-3 space-y-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Link
                      href={`/inventory/${p.id}`}
                      className="font-mono text-sm hover:underline"
                    >
                      {p.sku}
                    </Link>
                    {p.category && <span className="badge text-muted text-xs">{p.category}</span>}
                    <span className="ml-auto text-xs text-muted">
                      {p.createdAt.toLocaleDateString("en-US", { dateStyle: "medium" })}
                    </span>
                  </div>
                  <p className="text-xs text-muted">{decoded.label}</p>
                  {p.parentSku && (
                    <p className="text-xs text-muted">
                      Cut from <span className="font-mono">{p.parentSku}</span>
                    </p>
                  )}
                  {orders.length > 0 && (
                    <p className="text-xs text-muted">
                      Ordered on{" "}
                      {orders.map((o, i) => (
                        <span key={o.id}>
                          {i > 0 && ", "}
                          <Link href={`/orders/${o.id}`} className="font-mono hover:underline">
                            {o.orderNo}
                          </Link>
                        </span>
                      ))}
                    </p>
                  )}
                  {canLink && (
                    <form action={linkProductToNetsuite} className="flex gap-2">
                      <input type="hidden" name="productId" value={p.id} />
                      <input
                        name="netsuiteNumber"
                        required
                        placeholder="NetSuite item number"
                        className="input text-sm py-1"
                      />
                      <button className="btn btn-ghost py-1 px-3 text-sm" type="submit">
                        Mark matched
                      </button>
                    </form>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
