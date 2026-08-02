import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { skuQrSvg } from "@/lib/locations";
import PrintButton from "@/components/PrintButton";

export const dynamic = "force-dynamic";

// SKU-QR labels for Bases and Glass: the QR encodes the raw SKU, so a picker's
// scan resolves straight to the product. Glass usually ships with one but they go
// missing; a wrapped base needs one on the outside for picking and QC.
export default async function SkuLabelsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; cat?: string }>;
}) {
  const { q, cat } = await searchParams;

  const catOr: Prisma.ProductWhereInput[] =
    cat === "BASE"
      ? [{ category: { contains: "base", mode: "insensitive" } }]
      : cat === "GLASS"
        ? [{ category: { contains: "glass", mode: "insensitive" } }]
        : [
            { category: { contains: "base", mode: "insensitive" } },
            { category: { contains: "glass", mode: "insensitive" } },
          ];

  const products = await prisma.product.findMany({
    where: {
      active: true,
      AND: [
        { OR: catOr },
        ...(q
          ? [
              {
                OR: [
                  { sku: { contains: q, mode: "insensitive" as const } },
                  { name: { contains: q, mode: "insensitive" as const } },
                ],
              },
            ]
          : []),
      ],
    },
    orderBy: { sku: "asc" },
    take: 500,
    select: { id: true, sku: true, name: true },
  });

  const labels = await Promise.all(
    products.map(async (p) => ({ ...p, svg: await skuQrSvg(p.sku) }))
  );

  const tab = (key: string, label: string) => (
    <Link
      href={`/inventory/labels${key ? `?cat=${key}` : ""}`}
      className={`badge ${(cat ?? "") === key ? "text-ember" : "text-muted"}`}
    >
      {label}
    </Link>
  );

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <style>{`
        @media print {
          header, .no-print { display: none !important; }
          body { background: #fff !important; }
          .label-card { break-inside: avoid; border: 1px solid #000 !important; background: #fff !important; }
          .label-card .code, .label-card .name { color: #000 !important; }
        }
        .label-qr svg { width: 100%; height: auto; display: block; }
      `}</style>

      <div className="no-print flex items-center gap-3 mb-6 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">SKU-QR labels</h1>
          <p className="text-muted text-sm mt-1">
            {labels.length} label(s). The QR encodes the SKU, so picking and QC scans
            resolve to the product. Print, cut, and apply to Bases and Glass.
          </p>
        </div>
        <div className="ml-auto flex gap-2 items-center">
          <Link href="/inventory" className="btn btn-ghost">
            Back
          </Link>
          <PrintButton />
        </div>
      </div>

      <div className="no-print flex items-center gap-3 mb-6 flex-wrap">
        <div className="flex gap-1.5">
          {tab("", "Base + Glass")}
          {tab("BASE", "Bases")}
          {tab("GLASS", "Glass")}
        </div>
        <form action="/inventory/labels" method="get" className="ml-auto flex gap-2">
          {cat && <input type="hidden" name="cat" value={cat} />}
          <input
            name="q"
            defaultValue={q ?? ""}
            placeholder="Filter by SKU or name…"
            className="input max-w-xs"
          />
          <button className="btn btn-ghost" type="submit">
            Filter
          </button>
        </form>
      </div>

      {labels.length === 0 ? (
        <div className="card p-10 text-center text-muted no-print">
          No matching Base or Glass products to label.
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
          {labels.map((l) => (
            <div
              key={l.id}
              className="label-card card p-3 flex flex-col items-center text-center"
            >
              <div className="label-qr w-full max-w-[180px] bg-white p-2 rounded-lg">
                <div dangerouslySetInnerHTML={{ __html: l.svg }} />
              </div>
              <div className="code font-mono font-semibold text-xs mt-2 break-all">
                {l.sku}
              </div>
              <div className="name text-xs text-muted break-words">{l.name}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
