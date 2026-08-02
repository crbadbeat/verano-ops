import Link from "next/link";
import { getViewer } from "@/lib/permissions/engine";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { createSession } from "./actions";
import type { CountStatus } from "@prisma/client";

export const dynamic = "force-dynamic";

const STATUS_STYLE: Record<CountStatus, string> = {
  OPEN: "text-teal",
  REVIEW: "text-ember",
  POSTED: "text-success",
  CANCELLED: "text-muted",
};

export default async function CountHomePage() {
  const user = await getViewer();
  const canManage = can(user, "count:post");

  const [warehouses, sessions] = await Promise.all([
    prisma.location.findMany({
      where: { type: "WAREHOUSE", active: true },
      orderBy: { code: "asc" },
    }),
    prisma.countSession.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
      include: {
        warehouse: true,
        createdBy: { select: { email: true } },
        _count: { select: { entries: true } },
      },
    }),
  ]);

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 space-y-8">
      <div className="flex items-start gap-3 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Physical counts</h1>
          <p className="text-muted mt-1">
            Blind count by location, then a manager reviews variances and posts the
            adjustments to inventory.
          </p>
        </div>
        <Link href="/count/due" className="btn btn-ghost ml-auto">
          Due for count
        </Link>
      </div>

      {canManage &&
        (warehouses.length === 0 ? (
          <div className="card p-6 text-sm text-muted">
            Add a warehouse in{" "}
            <Link href="/admin/locations" className="text-ember underline">
              Locations
            </Link>{" "}
            before starting a count.
          </div>
        ) : (
          <div className="card p-5">
            <h3 className="font-semibold">Start a new count</h3>
            <form
              action={createSession}
              className="mt-3 flex flex-col sm:flex-row gap-3"
            >
              <select name="warehouseId" className="input sm:max-w-[220px]" required>
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name} ({w.code})
                  </option>
                ))}
              </select>
              <select name="type" className="input sm:max-w-[150px]" defaultValue="FULL">
                <option value="FULL">Full count</option>
                <option value="CYCLE">Cycle count</option>
              </select>
              <input
                name="label"
                placeholder="Label (optional)"
                className="input"
              />
              <button className="btn btn-primary whitespace-nowrap" type="submit">
                Start count
              </button>
            </form>
          </div>
        ))}

      <div className="card overflow-hidden">
        <div className="p-4 border-b border-border flex items-center gap-3">
          <h2 className="font-semibold">Counts</h2>
          <span className="badge">{sessions.length}</span>
        </div>
        {sessions.length === 0 ? (
          <div className="p-10 text-center text-muted">No counts yet.</div>
        ) : (
          <ul className="divide-y divide-border/60">
            {sessions.map((s) => (
              <li key={s.id}>
                <Link
                  href={`/count/${s.id}`}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-surface-2/40"
                >
                  <div className="min-w-0">
                    <div className="font-medium truncate">{s.label}</div>
                    <div className="text-xs text-muted">
                      {s.warehouse.code} · {s.type === "CYCLE" ? "cycle" : "full"} ·{" "}
                      {s._count.entries} entries · {s.createdBy?.email ?? "—"}
                    </div>
                  </div>
                  <span
                    className={`badge ml-auto ${STATUS_STYLE[s.status]}`}
                  >
                    {s.status}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
