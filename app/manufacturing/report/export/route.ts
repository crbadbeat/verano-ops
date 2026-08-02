import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getViewer } from "@/lib/permissions/engine";
import { can } from "@/lib/rbac";
import { centsToUsd } from "@/lib/manufacturing";

export const dynamic = "force-dynamic";

function csvCell(v: string): string {
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export async function GET(req: NextRequest) {
  const user = await getViewer();
  if (!can(user, "mfg.report:view")) {
    return new Response("Forbidden", { status: 403 });
  }

  const sp = new URL(req.url).searchParams;
  const now = new Date();
  const fromStr = sp.get("from");
  const toStr = sp.get("to");
  const from = fromStr
    ? new Date(`${fromStr}T00:00:00`)
    : new Date(now.getFullYear(), now.getMonth(), 1);
  const to = toStr ? new Date(`${toStr}T23:59:59`) : now;

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

  const header = ["Employee", "Code", "Jobs", "Bonus"].join(",");
  const lines = rows.map((r) =>
    [csvCell(r.name), csvCell(r.code ?? ""), String(r.jobs), centsToUsd(r.cents)].join(",")
  );
  const body = [header, ...lines].join("\r\n");

  const fname = `bonus-${from.toISOString().slice(0, 10)}-to-${to.toISOString().slice(0, 10)}.csv`;
  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${fname}"`,
    },
  });
}
