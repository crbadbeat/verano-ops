import Link from "next/link";
import { getViewer } from "@/lib/permissions/engine";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import SkuDatalist from "@/components/SkuDatalist";
import { onHandByProduct } from "@/lib/inventory";
import { isOverdue } from "@/lib/glass";
import {
  flagGlassMod,
  startGlassMod,
  completeGlassMod,
  cancelGlassMod,
} from "./actions";

export const dynamic = "force-dynamic";

function ymd(d: Date | null): string {
  return d ? d.toISOString().slice(0, 10) : "—";
}

export default async function GlassModsPage() {
  const user = await getViewer();
  const canOperate = can(user, "glass:execute");
  const today = new Date();

  const [queueRaw, completed, onHand, skus] = await Promise.all([
    prisma.glassMod.findMany({
      where: { status: { in: ["QUEUED", "IN_PROGRESS"] } },
      include: {
        sourceProduct: { select: { id: true, sku: true } },
        targetProduct: { select: { sku: true } },
      },
    }),
    prisma.glassMod.findMany({
      where: { status: { in: ["COMPLETED", "CANCELLED"] } },
      orderBy: { completedAt: "desc" },
      take: 25,
      include: {
        sourceProduct: { select: { sku: true } },
        targetProduct: { select: { sku: true } },
        completedBy: { select: { email: true } },
      },
    }),
    onHandByProduct(),
    prisma.product.findMany({
      where: { active: true },
      select: { sku: true, displayName: true, name: true },
      orderBy: { sku: "asc" },
    }),
  ]);

  // Most urgent first; jobs with no due date sink to the bottom.
  const queue = [...queueRaw].sort((a, b) => {
    const av = a.dueDate ? a.dueDate.getTime() : Number.POSITIVE_INFINITY;
    const bv = b.dueDate ? b.dueDate.getTime() : Number.POSITIVE_INFINITY;
    return av - bv;
  });

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 space-y-8">
      <div className="flex items-start gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Glass mods</h1>
          <p className="text-muted mt-1">
            Waterjet queue, worked by due date — 2 business days before the order&apos;s
            load date. Completing a cut deducts the original glass and adds the new
            configuration.
          </p>
        </div>
        <Link href="/glass/demand" className="btn btn-ghost ml-auto text-sm whitespace-nowrap">
          Glass needed
        </Link>
      </div>

      <SkuDatalist id="all-skus" products={skus} />

      {user && (
        <div className="card p-5">
          <h3 className="font-semibold">Flag glass to cut</h3>
          <form action={flagGlassMod} className="mt-3 space-y-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <input name="orderNo" placeholder="Order #" className="input" />
              <input name="customer" placeholder="Customer (optional)" className="input" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <label className="text-xs text-muted">
                Load date
                <input name="loadDate" type="date" className="input mt-1" />
              </label>
              <label className="text-xs text-muted">
                Due date (blank = 2 business days before load)
                <input name="dueDate" type="date" className="input mt-1" />
              </label>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <input
                name="sourceSku"
                list="all-skus"
                placeholder="Glass to cut (SKU)"
                required
                className="input font-mono"
              />
              <input
                name="targetSku"
                list="all-skus"
                placeholder="New config (SKU)"
                required
                className="input font-mono"
              />
              <input
                name="qty"
                type="number"
                min={1}
                defaultValue={1}
                className="input"
                aria-label="Quantity"
              />
            </div>
            <input name="note" placeholder="Note (optional)" className="input" />
            <button className="btn btn-primary" type="submit">
              Add to queue
            </button>
          </form>
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="p-4 border-b border-border flex items-center gap-3">
          <h2 className="font-semibold">Queue</h2>
          <span className="badge text-ember">{queue.length}</span>
        </div>
        {queue.length === 0 ? (
          <div className="p-10 text-center text-muted">Nothing waiting to be cut.</div>
        ) : (
          <ul className="divide-y divide-border/60">
            {queue.map((j) => {
              const available = onHand.get(j.sourceProduct.id) ?? 0;
              const short = available < j.qty;
              const late = j.status === "QUEUED" && isOverdue(j.dueDate, today);
              return (
                <li key={j.id} className="px-4 py-3 space-y-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      className={`badge ${late ? "text-danger" : "text-muted"}`}
                      title="Due date"
                    >
                      {ymd(j.dueDate)}
                      {late && " · overdue"}
                    </span>
                    {j.status === "IN_PROGRESS" && (
                      <span className="badge text-ember">cutting</span>
                    )}
                    {j.orderNo && (
                      <span className="text-sm">
                        #{j.orderNo}
                        {j.customer && (
                          <span className="text-muted"> · {j.customer}</span>
                        )}
                      </span>
                    )}
                    <span className="ml-auto text-sm tabular-nums">×{j.qty}</span>
                  </div>

                  <div className="flex items-center gap-2 flex-wrap text-sm">
                    <span className="font-mono text-xs">{j.sourceProduct.sku}</span>
                    <span className="text-muted">→</span>
                    <span className="font-mono text-xs text-teal">
                      {j.targetProduct.sku}
                    </span>
                    <span
                      className={`text-xs ml-auto ${short ? "text-danger" : "text-muted"}`}
                    >
                      {available} on hand{short ? " · short" : ""}
                    </span>
                  </div>

                  {j.note && <p className="text-xs text-muted">{j.note}</p>}

                  {canOperate && (
                    <div className="flex items-center gap-2">
                      {j.status === "QUEUED" && (
                        <form action={startGlassMod}>
                          <input type="hidden" name="glassModId" value={j.id} />
                          <button className="btn btn-ghost py-1 px-2 text-xs" type="submit">
                            Start
                          </button>
                        </form>
                      )}
                      <form action={completeGlassMod}>
                        <input type="hidden" name="glassModId" value={j.id} />
                        <button className="btn btn-primary py-1 px-3 text-xs" type="submit">
                          Complete cut
                        </button>
                      </form>
                      <form action={cancelGlassMod} className="ml-auto">
                        <input type="hidden" name="glassModId" value={j.id} />
                        <button
                          className="btn btn-ghost py-1 px-2 text-xs text-danger"
                          type="submit"
                        >
                          Cancel
                        </button>
                      </form>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {completed.length > 0 && (
        <div className="card overflow-hidden">
          <div className="p-4 border-b border-border">
            <h2 className="font-semibold">Recently finished</h2>
          </div>
          <ul className="divide-y divide-border/60">
            {completed.map((j) => (
              <li key={j.id} className="flex items-center gap-2 px-4 py-2 text-sm flex-wrap">
                <span className="font-mono text-xs">{j.sourceProduct.sku}</span>
                <span className="text-muted">→</span>
                <span className="font-mono text-xs">{j.targetProduct.sku}</span>
                <span className="text-xs text-muted">×{j.qty}</span>
                <span
                  className={`badge ml-auto ${
                    j.status === "COMPLETED" ? "text-success" : "text-muted"
                  }`}
                >
                  {j.status}
                </span>
                <span className="text-xs text-muted">
                  {j.completedAt
                    ? j.completedAt.toLocaleDateString("en-US", { dateStyle: "medium" })
                    : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
