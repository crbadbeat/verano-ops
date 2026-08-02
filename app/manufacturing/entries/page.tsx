import Link from "next/link";
import { redirect } from "next/navigation";
import { getViewer } from "@/lib/permissions/engine";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { STAGE_LABEL, centsToUsd, type Stage } from "@/lib/manufacturing";
import { voidEntry } from "../actions";

export const dynamic = "force-dynamic";

export default async function ManufacturingEntriesPage() {
  const user = await getViewer();
  if (!can(user, "mfg:view")) redirect("/");
  const canRecord = can(user, "mfg:record");

  const entries = await prisma.manufacturingEntry.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    include: {
      product: { select: { sku: true } },
      newProduct: { select: { sku: true } },
      baseStyle: { select: { code: true } },
      modReason: { select: { label: true } },
      pays: { include: { employee: { select: { name: true } } } },
    },
  });

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 space-y-6">
      <div className="flex items-center gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Recent entries</h1>
          <p className="text-muted text-sm mt-1">
            Last {entries.length}. Void to correct a mistake.
          </p>
        </div>
        <div className="ml-auto flex gap-2">
          <Link href="/manufacturing/report" className="btn btn-ghost">
            Bonus report
          </Link>
          <Link href="/manufacturing" className="btn btn-ghost">
            Back
          </Link>
        </div>
      </div>

      {entries.length === 0 ? (
        <div className="card p-10 text-center text-muted">No entries yet.</div>
      ) : (
        <ul className="space-y-2">
          {entries.map((e) => {
            const total = e.pays.reduce((s, p) => s + p.amountCents, 0);
            return (
              <li
                key={e.id}
                className={`card p-4 ${e.voided ? "opacity-60" : ""}`}
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="badge">{e.kind}</span>
                  <span className="font-semibold">
                    {STAGE_LABEL[e.stage as Stage]}
                  </span>
                  {e.baseStyle && (
                    <span className="badge font-mono">{e.baseStyle.code}</span>
                  )}
                  {e.product && (
                    <span className="font-mono text-xs text-muted">
                      {e.product.sku}
                      {e.newProduct && ` → ${e.newProduct.sku}`}
                    </span>
                  )}
                  {e.modReason && (
                    <span className="text-xs text-muted">· {e.modReason.label}</span>
                  )}
                  <span className="ml-auto font-semibold tabular-nums">
                    ${centsToUsd(total)}
                  </span>
                </div>

                <div className="mt-2 flex items-center gap-2 flex-wrap text-sm">
                  {e.pays.map((p) => (
                    <span key={p.id} className="text-muted">
                      {p.employee.name}
                      <span className="text-foreground"> ${centsToUsd(p.amountCents)}</span>
                    </span>
                  ))}
                  <span className="ml-auto text-xs text-muted">
                    {e.createdAt.toLocaleString("en-US", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </span>
                </div>

                <div className="mt-2 flex items-center gap-2">
                  {e.note && <span className="text-xs text-muted">{e.note}</span>}
                  {e.voided ? (
                    <span className="badge text-danger ml-auto">Voided</span>
                  ) : canRecord ? (
                    <form action={voidEntry} className="ml-auto">
                      <input type="hidden" name="entryId" value={e.id} />
                      <button
                        type="submit"
                        className="btn btn-ghost py-1 px-2 text-xs text-danger"
                      >
                        Void
                      </button>
                    </form>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
