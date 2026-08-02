import Link from "next/link";
import { notFound } from "next/navigation";
import { getViewer } from "@/lib/permissions/engine";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { warehouseLevelLocationId } from "@/lib/locations";
import { productDisplayName } from "@/lib/item-master";
import { cancelSession } from "../actions";
import CountEntryClient, {
  type EntryRow,
} from "@/components/count/CountEntryClient";
import type { CountStatus } from "@prisma/client";

export const dynamic = "force-dynamic";

const STATUS_STYLE: Record<CountStatus, string> = {
  OPEN: "text-teal",
  REVIEW: "text-ember",
  POSTED: "text-success",
  CANCELLED: "text-muted",
};

export default async function CountSessionPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  const user = await getViewer();
  const canManage = can(user, "count:post");

  const session = await prisma.countSession.findUnique({
    where: { id: sessionId },
    include: {
      warehouse: true,
      entries: {
        orderBy: { countedAt: "asc" },
        include: {
          product: { select: { sku: true, displayName: true, name: true } },
          location: { select: { code: true } },
        },
      },
    },
  });
  if (!session) notFound();

  const bins = await prisma.location.findMany({
    where: { type: "BIN", parentId: session.warehouseId, active: true },
    orderBy: { code: "asc" },
    select: { id: true, code: true, name: true },
  });

  const rows: EntryRow[] = session.entries.map((e) => ({
    id: e.id,
    qty: e.qty,
    method: e.method,
    condition: e.condition,
    crateCount: e.crateCount,
    productSku: e.product?.sku ?? null,
    productName: e.product ? productDisplayName(e.product) : null,
    rawSku: e.rawSku,
    locationId: e.locationId,
    locationCode: e.location?.code ?? null,
  }));

  const isOpen = session.status === "OPEN";

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 space-y-6">
      <div className="flex items-center gap-3 flex-wrap">
        <Link href="/count" className="text-muted hover:text-foreground text-sm">
          ← Counts
        </Link>
        <span className={`badge ${STATUS_STYLE[session.status]}`}>
          {session.status}
        </span>
      </div>

      <div className="flex items-start gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{session.label}</h1>
          <p className="text-muted text-sm mt-1">
            {session.warehouse.name} ({session.warehouse.code}) · {rows.length}{" "}
            entries
          </p>
        </div>
        <div className="ml-auto flex gap-2">
          {canManage && (
            <Link
              href={`/count/${session.id}/review`}
              className="btn btn-ghost"
            >
              {isOpen ? "Review & post →" : "View review"}
            </Link>
          )}
          {canManage && session.status !== "POSTED" && session.status !== "CANCELLED" && (
            <form action={cancelSession}>
              <input type="hidden" name="sessionId" value={session.id} />
              <button className="btn btn-ghost text-danger" type="submit">
                Cancel
              </button>
            </form>
          )}
        </div>
      </div>

      {isOpen ? (
        <CountEntryClient
          sessionId={session.id}
          bins={bins}
          entries={rows}
          // Ocoee keeps the legacy null-location convention; other sites
          // (showrooms, AZ) hold their warehouse-level stock at their own id.
          warehouseLevelLocationId={warehouseLevelLocationId(session.warehouse)}
        />
      ) : (
        <ReadonlyEntries rows={rows} status={session.status} />
      )}
    </div>
  );
}

function ReadonlyEntries({
  rows,
  status,
}: {
  rows: EntryRow[];
  status: CountStatus;
}) {
  const note =
    status === "POSTED"
      ? "This count has been posted to inventory."
      : status === "CANCELLED"
        ? "This count was cancelled."
        : "This count is in review — entries are frozen.";

  return (
    <div className="space-y-4">
      <div className="card p-4 text-sm text-muted">{note}</div>
      <div className="card overflow-hidden">
        <div className="p-4 border-b border-border">
          <h3 className="font-semibold">Entries</h3>
        </div>
        {rows.length === 0 ? (
          <div className="p-8 text-center text-muted text-sm">No entries.</div>
        ) : (
          <ul className="divide-y divide-border/60">
            {rows.map((e) => (
              <li key={e.id} className="flex items-center gap-2 px-4 py-2 text-sm">
                <span className="font-mono text-xs">
                  {e.productSku ?? e.rawSku ?? "—"}
                </span>
                <span className="text-muted truncate">{e.productName ?? ""}</span>
                <span className="text-muted ml-auto text-xs">
                  {e.locationCode ?? "warehouse"}
                </span>
                <span className="font-semibold tabular-nums w-10 text-right">
                  {e.qty}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
