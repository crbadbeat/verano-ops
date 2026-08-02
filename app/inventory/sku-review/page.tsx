import Link from "next/link";
import { prisma } from "@/lib/db";
import { validateSku, type SkuValidation } from "@/lib/sku-validate";

export const dynamic = "force-dynamic";

/** Human names for the glass forms, so the summary reads as English. */
const FORM_LABEL: Record<string, string> = {
  configured: "configured top",
  blank: "blank (uncut)",
  bare: "short code",
};

export default async function SkuReviewPage() {
  const products = await prisma.product.findMany({
    select: { id: true, sku: true, name: true, category: true },
    orderBy: { sku: "asc" },
  });

  const checked: { id: string; name: string; v: SkuValidation }[] = [];
  for (const p of products) {
    checked.push({ id: p.id, name: p.name, v: validateSku(p.sku, p.category) });
  }

  const flagged = checked.filter((c) => !c.v.ok);
  // Products whose category has no grammar are plain SKUs — nothing to check.
  const graded = checked.filter((c) => c.v.ok && c.v.variant !== undefined);
  const plain = checked.length - graded.length - flagged.length;

  const forms = new Map<string, number>();
  for (const c of graded) {
    const k = c.v.variant ?? "-";
    forms.set(k, (forms.get(k) ?? 0) + 1);
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 space-y-6">
      <div className="flex items-start gap-3 flex-wrap">
        <div>
          <Link href="/inventory" className="text-muted hover:text-foreground text-sm">
            ← Inventory
          </Link>
          <h1 className="text-2xl font-bold tracking-tight mt-1">SKU review</h1>
          <p className="text-muted text-sm mt-1">
            Every Base and Glass SKU read against the smart-SKU grammar. Anything
            the grammar cannot explain lands here to be corrected rather than
            silently imported.
          </p>
        </div>
        <div className="ml-auto text-right">
          <div
            className={`text-3xl font-bold ${
              flagged.length ? "text-danger" : "text-ember"
            }`}
          >
            {flagged.length}
          </div>
          <div className="text-xs text-muted">need review</div>
        </div>
      </div>

      <div className="card p-4">
        <h2 className="font-semibold mb-3">Coverage</h2>
        <div className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
          <div>
            <span className="text-muted">Checked against a grammar </span>
            <span className="font-semibold tabular-nums">{graded.length}</span>
          </div>
          {[...forms.entries()].sort().map(([form, n]) => (
            <div key={form}>
              <span className="text-muted">{FORM_LABEL[form] ?? form} </span>
              <span className="font-semibold tabular-nums">{n}</span>
            </div>
          ))}
          <div>
            <span className="text-muted">Plain items (no grammar) </span>
            <span className="font-semibold tabular-nums">{plain}</span>
          </div>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="p-4 border-b border-border flex items-center gap-3">
          <h2 className="font-semibold">Needs review</h2>
          <span className="badge">{flagged.length}</span>
        </div>

        {flagged.length === 0 ? (
          <div className="p-10 text-center text-muted">
            All {graded.length} Base and Glass SKUs parse cleanly. Nothing to review.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-muted text-left">
                <tr className="border-b border-border">
                  <th className="px-4 py-2 font-medium">SKU</th>
                  <th className="px-4 py-2 font-medium">Category</th>
                  <th className="px-4 py-2 font-medium">What&apos;s wrong</th>
                  <th className="px-4 py-2 font-medium">Suggested</th>
                </tr>
              </thead>
              <tbody>
                {flagged.map(({ id, name, v }) => (
                  <tr key={id} className="border-b border-border/50 align-top">
                    <td className="px-4 py-2 font-mono text-xs">
                      <Link
                        href={`/inventory/${id}`}
                        className="hover:text-ember hover:underline"
                      >
                        {v.sku}
                      </Link>
                      <div className="text-muted font-sans mt-0.5">{name}</div>
                    </td>
                    <td className="px-4 py-2 text-muted">{v.category ?? "—"}</td>
                    <td className="px-4 py-2">
                      <ul className="space-y-1">
                        {v.problems.map((p, i) => (
                          <li key={i} className="text-danger">
                            {p.detail}
                          </li>
                        ))}
                      </ul>
                    </td>
                    <td className="px-4 py-2 font-mono text-xs">
                      {v.suggestion ? (
                        <span className="text-ember">{v.suggestion}</span>
                      ) : (
                        <span className="text-muted font-sans">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="text-muted text-xs">
        Suggestions are shown, never applied — a SKU is the product&apos;s identity
        and renaming one moves its ledger history with it.
      </p>
    </div>
  );
}
