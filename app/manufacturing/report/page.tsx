import Link from "next/link";
import { redirect } from "next/navigation";
import { getViewer } from "@/lib/permissions/engine";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { centsToUsd } from "@/lib/manufacturing";

export const dynamic = "force-dynamic";

function monthStart(): Date {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), 1);
}
function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export default async function BonusReportPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const user = await getViewer();
  if (!can(user, "mfg.report:view")) redirect("/");

  const { from: fromStr, to: toStr } = await searchParams;
  const from = fromStr ? new Date(`${fromStr}T00:00:00`) : monthStart();
  const to = toStr ? new Date(`${toStr}T23:59:59`) : new Date();

  const pays = await prisma.manufacturingPay.findMany({
    where: { entry: { voided: false, createdAt: { gte: from, lte: to } } },
    include: { employee: { select: { name: true, code: true } } },
  });

  const map = new Map<
    string,
    { name: string; code: string | null; cents: number; jobs: number }
  >();
  for (const p of pays) {
    const cur =
      map.get(p.employeeId) ??
      { name: p.employee.name, code: p.employee.code, cents: 0, jobs: 0 };
    cur.cents += p.amountCents;
    cur.jobs += 1;
    map.set(p.employeeId, cur);
  }
  const rows = [...map.values()].sort((a, b) => b.cents - a.cents);
  const grand = rows.reduce((s, r) => s + r.cents, 0);

  const exportHref = `/manufacturing/report/export?from=${ymd(from)}&to=${ymd(to)}`;

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 space-y-6">
      <div className="flex items-center gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Bonus report</h1>
          <p className="text-muted text-sm mt-1">
            Per-worker bonus (voided entries excluded). Export for payroll.
          </p>
        </div>
        <Link href="/manufacturing" className="btn btn-ghost ml-auto">
          Back
        </Link>
      </div>

      <div className="card p-4">
        <form
          action="/manufacturing/report"
          method="get"
          className="flex flex-wrap items-end gap-3"
        >
          <label className="text-sm">
            <span className="text-muted">From</span>
            <input
              type="date"
              name="from"
              defaultValue={ymd(from)}
              className="input mt-1"
            />
          </label>
          <label className="text-sm">
            <span className="text-muted">To</span>
            <input
              type="date"
              name="to"
              defaultValue={ymd(to)}
              className="input mt-1"
            />
          </label>
          <button className="btn btn-ghost" type="submit">
            Apply
          </button>
          <a href={exportHref} className="btn btn-primary ml-auto">
            Download CSV
          </a>
        </form>
      </div>

      <div className="card overflow-hidden">
        <div className="p-4 border-b border-border flex items-center gap-3">
          <h2 className="font-semibold">Workers</h2>
          <span className="badge">{rows.length}</span>
          <span className="ml-auto font-semibold tabular-nums">
            Total ${centsToUsd(grand)}
          </span>
        </div>
        {rows.length === 0 ? (
          <div className="p-10 text-center text-muted">
            No bonus recorded in this range.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-muted text-left">
              <tr className="border-b border-border">
                <th className="px-4 py-2 font-medium">Worker</th>
                <th className="px-4 py-2 font-medium">Code</th>
                <th className="px-4 py-2 font-medium text-right">Jobs</th>
                <th className="px-4 py-2 font-medium text-right">Bonus</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-b border-border/50">
                  <td className="px-4 py-2">{r.name}</td>
                  <td className="px-4 py-2 font-mono text-xs text-muted">
                    {r.code ?? "—"}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">{r.jobs}</td>
                  <td className="px-4 py-2 text-right tabular-nums font-semibold">
                    ${centsToUsd(r.cents)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
