import { headers } from "next/headers";
import { getViewer } from "@/lib/permissions/engine";
import Link from "next/link";
import { notFound } from "next/navigation";

import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { locationQrSvg } from "@/lib/locations";
import PrintButton from "@/components/PrintButton";

export const dynamic = "force-dynamic";

export default async function LocationLabelsPage({
  searchParams,
}: {
  searchParams: Promise<{ wh?: string }>;
}) {
  const user = await getViewer();
  if (!can(user, "admin.locations:edit")) notFound();

  const { wh } = await searchParams;

  const h = await headers();
  const host = h.get("host") ?? "localhost:3000";
  const proto =
    h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const origin = `${proto}://${host}`;

  const locations = await prisma.location.findMany({
    where: {
      active: true,
      ...(wh ? { OR: [{ id: wh }, { parentId: wh }] } : {}),
    },
    orderBy: [{ type: "asc" }, { code: "asc" }],
  });

  const labels = await Promise.all(
    locations.map(async (l) => ({
      id: l.id,
      code: l.code,
      name: l.name,
      svg: await locationQrSvg(l.code, origin),
    }))
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
          <h1 className="text-2xl font-bold tracking-tight">Location labels</h1>
          <p className="text-muted text-sm mt-1">
            {labels.length} label(s). Print, cut, and post one at each location.
          </p>
        </div>
        <div className="ml-auto flex gap-2">
          <Link href="/admin/locations" className="btn btn-ghost">
            Back
          </Link>
          <PrintButton />
        </div>
      </div>

      {labels.length === 0 ? (
        <div className="card p-10 text-center text-muted no-print">
          No active locations to label yet.
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
              <div className="code font-mono font-semibold mt-2 break-all">
                {l.code}
              </div>
              <div className="name text-xs text-muted break-words">{l.name}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
