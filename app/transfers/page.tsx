import Link from "next/link";
import { getViewer } from "@/lib/permissions/engine";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { IN_TRANSIT_CODE } from "@/lib/locations";
import { createTransfer } from "./actions";
import type { TransferStatus } from "@prisma/client";

export const dynamic = "force-dynamic";

const STATUS_STYLE: Record<TransferStatus, string> = {
  STAGED: "text-teal",
  IN_TRANSIT: "text-ember",
  RECEIVED: "text-success",
  CANCELLED: "text-muted",
};

export default async function TransfersPage() {
  const user = await getViewer();
  const canManage = can(user, "transfers:edit");

  const [warehouses, transfers] = await Promise.all([
    prisma.location.findMany({
      where: { type: "WAREHOUSE", active: true, code: { not: IN_TRANSIT_CODE } },
      orderBy: { code: "asc" },
    }),
    prisma.transfer.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
      include: {
        destWarehouse: { select: { code: true, name: true } },
        _count: { select: { lines: true } },
      },
    }),
  ]);

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Transfers</h1>
        <p className="text-muted mt-1">
          Move stock to another warehouse. Depart relieves Ocoee into in-transit;
          receiving lands it at the destination.
        </p>
      </div>

      {canManage &&
        (warehouses.length === 0 ? (
          <div className="card p-6 text-sm text-muted">
            Add a destination warehouse in{" "}
            <Link href="/admin/locations" className="text-ember underline">
              Locations
            </Link>{" "}
            first.
          </div>
        ) : (
          <div className="card p-5">
            <h3 className="font-semibold">New transfer</h3>
            <form
              action={createTransfer}
              className="mt-3 flex flex-col sm:flex-row gap-3"
            >
              <select name="destWarehouseId" required className="input sm:max-w-[240px]">
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name} ({w.code})
                  </option>
                ))}
              </select>
              <input
                name="reference"
                placeholder="Reference (optional)"
                className="input"
              />
              <button className="btn btn-primary whitespace-nowrap" type="submit">
                Start transfer
              </button>
            </form>
          </div>
        ))}

      <div className="card overflow-hidden">
        <div className="p-4 border-b border-border flex items-center gap-3">
          <h2 className="font-semibold">Recent</h2>
          <span className="badge">{transfers.length}</span>
        </div>
        {transfers.length === 0 ? (
          <div className="p-10 text-center text-muted">No transfers yet.</div>
        ) : (
          <ul className="divide-y divide-border/60">
            {transfers.map((t) => (
              <li key={t.id}>
                <Link
                  href={`/transfers/${t.id}`}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-surface-2/40"
                >
                  <div className="min-w-0">
                    <div className="font-medium truncate">
                      {t.reference ?? "Transfer"} → {t.destWarehouse.code}
                    </div>
                    <div className="text-xs text-muted">
                      {t._count.lines} lines ·{" "}
                      {t.createdAt.toLocaleDateString("en-US", { dateStyle: "medium" })}
                    </div>
                  </div>
                  <span className={`badge ml-auto ${STATUS_STYLE[t.status]}`}>
                    {t.status.replace("_", " ")}
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
