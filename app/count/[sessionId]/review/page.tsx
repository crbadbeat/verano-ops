import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getViewer } from "@/lib/permissions/engine";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import SkuDatalist from "@/components/SkuDatalist";
import { aggregateCounts } from "@/lib/count";
import { productDisplayName } from "@/lib/item-master";
import { onHandByProductLocation, productLocationKey } from "@/lib/inventory";
import {
  postSession,
  startReview,
  reopenSession,
  mapCountEntry,
} from "../../actions";

export const dynamic = "force-dynamic";

export default async function CountReviewPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  const user = await getViewer();
  if (!can(user, "count:post")) redirect("/count");

  const session = await prisma.countSession.findUnique({
    where: { id: sessionId },
    include: {
      warehouse: true,
      entries: {
        include: {
          product: { select: { sku: true, displayName: true, name: true } },
          location: { select: { code: true } },
        },
      },
    },
  });
  if (!session) notFound();

  const unmatched = session.entries.filter((e) => !e.productId);
  const matched = session.entries.filter((e) => e.productId);

  // Aggregate counted per (product, location, condition) and compare to derived
  // on-hand. Show goods share bins with new stock, so they are separate rows.
  const agg = aggregateCounts(
    matched.map((e) => ({
      productId: e.productId,
      locationId: e.locationId,
      condition: e.condition,
      qty: e.qty,
    }))
  );
  const productIds = [...new Set(matched.map((e) => e.productId!))];
  const derived = await onHandByProductLocation(productIds);

  const skuOf = new Map<string, string>();
  const nameOf = new Map<string, string>();
  const codeOf = new Map<string, string>();
  for (const e of session.entries) {
    if (e.productId && e.product) {
      skuOf.set(e.productId, e.product.sku);
      nameOf.set(e.productId, productDisplayName(e.product));
    }
    if (e.locationId && e.location) codeOf.set(e.locationId, e.location.code);
  }

  const rows = agg
    .map((a) => {
      const system =
        derived.get(
          productLocationKey(a.productId!, a.locationId, a.condition)
        ) ?? 0;
      return {
        sku: skuOf.get(a.productId!) ?? "—",
        name: nameOf.get(a.productId!) ?? "",
        loc: a.locationId ? codeOf.get(a.locationId) ?? "—" : "warehouse",
        condition: a.condition,
        counted: a.counted,
        system,
        variance: a.counted - system,
      };
    })
    .sort((x, y) => Math.abs(y.variance) - Math.abs(x.variance));

  const withVariance = rows.filter((r) => r.variance !== 0).length;
  const canPost =
    (session.status === "OPEN" || session.status === "REVIEW") &&
    unmatched.length === 0;

  const allSkus = await prisma.product.findMany({
    where: { active: true },
    select: { sku: true, displayName: true, name: true },
    orderBy: { sku: "asc" },
  });

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 space-y-6">
      <div className="flex items-center gap-3 flex-wrap">
        <Link
          href={`/count/${session.id}`}
          className="text-muted hover:text-foreground text-sm"
        >
          ← {session.label}
        </Link>
        <span className="badge">{session.status}</span>
      </div>

      <div>
        <h1 className="text-2xl font-bold tracking-tight">Review variances</h1>
        <p className="text-muted text-sm mt-1">
          {rows.length} slots · {withVariance} with a variance ·{" "}
          {session.warehouse.code}
        </p>
      </div>

      {/* Unmatched entries must be mapped before posting */}
      {unmatched.length > 0 && (
        <div className="card p-4 space-y-3 border-danger/40">
          <h3 className="font-semibold text-danger">
            {unmatched.length} unmatched item(s) — map before posting
          </h3>
          <SkuDatalist id="all-skus" products={allSkus} />
          <ul className="space-y-2">
            {unmatched.map((e) => (
              <li key={e.id} className="flex items-center gap-2 flex-wrap">
                <span className="font-mono text-xs">{e.rawSku ?? "—"}</span>
                <span className="text-muted text-xs">
                  {e.location?.code ?? "warehouse"} · qty {e.qty}
                </span>
                <form action={mapCountEntry} className="flex items-center gap-1 ml-auto">
                  <input type="hidden" name="entryId" value={e.id} />
                  <input
                    name="sku"
                    list="all-skus"
                    placeholder="pick SKU…"
                    required
                    className="input py-1 max-w-[220px]"
                  />
                  <button className="btn btn-ghost py-1 px-2 text-xs" type="submit">
                    Map
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Variance table */}
      <div className="card overflow-hidden">
        <div className="p-4 border-b border-border">
          <h3 className="font-semibold">Counted vs system</h3>
        </div>
        {rows.length === 0 ? (
          <div className="p-8 text-center text-muted text-sm">
            No matched entries yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-muted text-left">
                <tr className="border-b border-border">
                  <th className="px-4 py-2 font-medium">SKU</th>
                  <th className="px-4 py-2 font-medium">Location</th>
                  <th className="px-4 py-2 font-medium">Condition</th>
                  <th className="px-4 py-2 font-medium text-right">Counted</th>
                  <th className="px-4 py-2 font-medium text-right">System</th>
                  <th className="px-4 py-2 font-medium text-right">Variance</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-b border-border/50">
                    <td className="px-4 py-2 font-mono text-xs">{r.sku}</td>
                    <td className="px-4 py-2 text-muted">{r.loc}</td>
                    <td className="px-4 py-2">
                      {r.condition === "SHOW_GOOD" ? (
                        <span className="badge text-showgood">Show good</span>
                      ) : (
                        <span className="text-muted">New</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">{r.counted}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-muted">
                      {r.system}
                    </td>
                    <td
                      className={`px-4 py-2 text-right tabular-nums font-semibold ${
                        r.variance === 0
                          ? "text-muted"
                          : r.variance > 0
                            ? "text-success"
                            : "text-danger"
                      }`}
                    >
                      {r.variance > 0 ? `+${r.variance}` : r.variance}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 flex-wrap">
        {session.status === "OPEN" && (
          <form action={startReview}>
            <input type="hidden" name="sessionId" value={session.id} />
            <button className="btn btn-ghost" type="submit">
              Freeze counting
            </button>
          </form>
        )}
        {session.status === "REVIEW" && (
          <form action={reopenSession}>
            <input type="hidden" name="sessionId" value={session.id} />
            <button className="btn btn-ghost" type="submit">
              Reopen counting
            </button>
          </form>
        )}

        {session.status === "POSTED" ? (
          <span className="badge text-success">Posted</span>
        ) : (
          <form action={postSession} className="ml-auto">
            <input type="hidden" name="sessionId" value={session.id} />
            <button
              className="btn btn-primary"
              type="submit"
              disabled={!canPost}
              title={
                unmatched.length
                  ? "Map all unmatched items first"
                  : "Write adjustments to inventory"
              }
            >
              Post adjustments
            </button>
          </form>
        )}
      </div>
      {!canPost && unmatched.length > 0 && (
        <p className="text-sm text-danger">
          Map all unmatched items before posting.
        </p>
      )}
    </div>
  );
}
