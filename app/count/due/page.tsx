import Link from "next/link";
import { prisma } from "@/lib/db";
import { productDisplayName } from "@/lib/item-master";

export const dynamic = "force-dynamic";

const MAX_ROWS = 100;

function key(productId: string | null, locationId: string | null): string {
  return `${productId ?? "_"}::${locationId ?? "_"}`;
}

export default async function DueForCountPage() {
  const [slots, counted, locations] = await Promise.all([
    // Every (product, location) slot that currently holds stock.
    prisma.inventoryLedger.groupBy({
      by: ["productId", "locationId"],
      _sum: { qtyDelta: true },
    }),
    // When each slot was last counted in a POSTED session.
    prisma.countEntry.groupBy({
      by: ["productId", "locationId"],
      where: { session: { status: "POSTED" } },
      _max: { countedAt: true },
    }),
    prisma.location.findMany({ select: { id: true, code: true } }),
  ]);

  const lastMap = new Map<string, Date>();
  for (const c of counted) {
    if (c._max.countedAt) lastMap.set(key(c.productId, c.locationId), c._max.countedAt);
  }
  const locCode = new Map(locations.map((l) => [l.id, l.code]));

  const rows = slots
    .filter((s) => (s._sum.qtyDelta ?? 0) !== 0)
    .map((s) => ({
      productId: s.productId,
      locationId: s.locationId,
      qty: s._sum.qtyDelta ?? 0,
      lastCounted: lastMap.get(key(s.productId, s.locationId)) ?? null,
    }))
    // Never-counted first, then longest-since-counted.
    .sort((a, b) => {
      const av = a.lastCounted ? a.lastCounted.getTime() : -1;
      const bv = b.lastCounted ? b.lastCounted.getTime() : -1;
      return av - bv;
    });

  const top = rows.slice(0, MAX_ROWS);
  const products = await prisma.product.findMany({
    where: { id: { in: [...new Set(top.map((r) => r.productId))] } },
    select: { id: true, sku: true, displayName: true, name: true },
  });
  const prod = new Map(products.map((p) => [p.id, p]));
  const neverCounted = rows.filter((r) => !r.lastCounted).length;

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 space-y-6">
      <div className="flex items-start gap-3 flex-wrap">
        <div>
          <Link href="/count" className="text-muted hover:text-foreground text-sm">
            ← Counts
          </Link>
          <h1 className="text-2xl font-bold tracking-tight mt-1">Due for count</h1>
          <p className="text-muted text-sm mt-1">
            Slots holding stock, longest-since-counted first. Work the top of this
            list as your cycle count.
          </p>
        </div>
        <div className="ml-auto text-right">
          <div className="text-3xl font-bold text-ember">{neverCounted}</div>
          <div className="text-xs text-muted">never counted</div>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="p-4 border-b border-border flex items-center gap-3">
          <h2 className="font-semibold">Slots</h2>
          <span className="badge">{rows.length}</span>
          {rows.length > MAX_ROWS && (
            <span className="text-xs text-muted ml-auto">
              showing the {MAX_ROWS} most overdue
            </span>
          )}
        </div>
        {top.length === 0 ? (
          <div className="p-10 text-center text-muted">
            No stock on hand yet — nothing to cycle count.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-muted text-left">
                <tr className="border-b border-border">
                  <th className="px-4 py-2 font-medium">SKU</th>
                  <th className="px-4 py-2 font-medium">Location</th>
                  <th className="px-4 py-2 font-medium text-right">On hand</th>
                  <th className="px-4 py-2 font-medium text-right">Last counted</th>
                </tr>
              </thead>
              <tbody>
                {top.map((r, i) => {
                  const p = prod.get(r.productId);
                  return (
                    <tr key={i} className="border-b border-border/50">
                      <td className="px-4 py-2 font-mono text-xs">
                        {p ? (
                          <Link
                            href={`/inventory/${p.id}`}
                            className="hover:text-ember hover:underline"
                          >
                            {p.sku}
                          </Link>
                        ) : (
                          "—"
                        )}
                        {p && (
                          <span className="text-muted font-sans"> — {productDisplayName(p)}</span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-muted">
                        {r.locationId ? locCode.get(r.locationId) ?? "—" : "warehouse"}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">{r.qty}</td>
                      <td className="px-4 py-2 text-right whitespace-nowrap">
                        {r.lastCounted ? (
                          <span className="text-muted">
                            {r.lastCounted.toLocaleDateString("en-US", {
                              dateStyle: "medium",
                            })}
                          </span>
                        ) : (
                          <span className="text-danger">never</span>
                        )}
                      </td>
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
