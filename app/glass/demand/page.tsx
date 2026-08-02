import Link from "next/link";
import { prisma } from "@/lib/db";
import { onHandByProduct } from "@/lib/inventory";

export const dynamic = "force-dynamic";

// What glass the order book is going to need, and whether the blanks to cut it
// from are on the floor.
//
// This page deliberately CREATES NOTHING. A blank is fungible and a customer may
// buy five months before they take delivery, so cutting on order would spend a
// blank the next sale needs. Glass is cut once the customer is scheduled — this
// is the view that tells customer service what they can promise.

export default async function GlassDemandPage() {
  const islands = await prisma.orderIsland.findMany({
    where: {
      topSku: { not: null },
      topBlankSku: { not: null },
      order: { status: { in: ["DRAFT", "CONFIRMED", "SCHEDULED"] } },
    },
    include: {
      order: { select: { id: true, orderNo: true, status: true, loadDate: true } },
      topProduct: { select: { id: true, sku: true } },
    },
  });

  const blankSkus = [...new Set(islands.map((i) => i.topBlankSku!))];
  const [blanks, onHand] = await Promise.all([
    blankSkus.length
      ? prisma.product.findMany({
          where: { sku: { in: blankSkus } },
          select: { id: true, sku: true },
        })
      : Promise.resolve([]),
    onHandByProduct(),
  ]);
  const blankBySku = new Map(blanks.map((b) => [b.sku, b]));

  // Group the demand by the blank it draws down.
  const groups = new Map<
    string,
    { blankSku: string; needed: number; rows: typeof islands }
  >();
  for (const island of islands) {
    const key = island.topBlankSku!;
    const group = groups.get(key) ?? { blankSku: key, needed: 0, rows: [] };
    group.needed += 1;
    group.rows.push(island);
    groups.set(key, group);
  }

  const ordered = [...groups.values()].sort((a, b) => a.blankSku.localeCompare(b.blankSku));

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 space-y-8">
      <div>
        <Link href="/glass" className="text-sm text-muted hover:underline">
          ← Glass mods
        </Link>
        <h1 className="text-3xl font-bold tracking-tight mt-2">Glass needed by the order book</h1>
        <p className="text-muted mt-1">
          Tops that have been sold but not yet cut, grouped by the uncut blank they
          come from. Nothing here is queued for the waterjet — glass is cut once the
          customer is scheduled, so a blank stays available until then.
        </p>
      </div>

      {ordered.length === 0 ? (
        <div className="card p-10 text-center text-muted">
          No open orders need glass cut.
        </div>
      ) : (
        <div className="space-y-4">
          {ordered.map((group) => {
            const blank = blankBySku.get(group.blankSku);
            const available = blank ? onHand.get(blank.id) ?? 0 : 0;
            const short = available < group.needed;
            return (
              <div key={group.blankSku} className="card overflow-hidden">
                <div className="p-4 border-b border-border flex items-center gap-3 flex-wrap">
                  <span className="font-mono text-sm">{group.blankSku}</span>
                  <span className="badge text-muted">{group.needed} needed</span>
                  {blank ? (
                    <span className={`badge ml-auto ${short ? "text-danger" : "text-success"}`}>
                      {available} on hand{short ? ` · short ${group.needed - available}` : ""}
                    </span>
                  ) : (
                    <span className="badge text-danger ml-auto">not a product here</span>
                  )}
                </div>
                <ul className="divide-y divide-border/60">
                  {group.rows.map((island) => (
                    <li
                      key={island.id}
                      className="px-4 py-2.5 flex items-center gap-3 text-sm flex-wrap"
                    >
                      <Link
                        href={`/orders/${island.order.id}`}
                        className="font-mono text-xs hover:underline"
                      >
                        {island.order.orderNo}
                      </Link>
                      <span className="badge text-muted text-xs">{island.order.status}</span>
                      <span className="font-mono text-xs text-teal">{island.topSku}</span>
                      <span className="ml-auto text-xs text-muted">
                        {island.order.loadDate
                          ? island.order.loadDate.toISOString().slice(0, 10)
                          : "not scheduled"}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
