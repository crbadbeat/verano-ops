import Link from "next/link";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { stagingDateForLoadDate, isoDate } from "@/lib/scheduling";
import { isOverdue } from "@/lib/glass";
import PageHeader from "@/components/ui/PageHeader";
import StatusChip from "@/components/ui/StatusChip";
import type { OrderType } from "@prisma/client";

export const dynamic = "force-dynamic";

const TYPE_LABEL: Record<OrderType, string> = {
  CUSTOMER_DELIVERY: "Delivery",
  TRANSFER: "Transfer",
  SHOW: "Show",
  SERVICE: "Service",
};

function longDate(d: Date): string {
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export default async function StagingPage() {
  await getSessionUser();

  const trips = await prisma.deliveryTrip.findMany({
    where: { status: { in: ["FINALIZED", "STAGING"] } },
    orderBy: { loadDate: "asc" },
    include: {
      _count: { select: { orders: true } },
      lanes: { orderBy: { position: "asc" }, include: { lane: { select: { code: true } } } },
    },
  });
  const today = new Date();

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 space-y-8">
      <PageHeader
        title="Pick & stage"
        description="Finalized trips to pick and stage. Work the earliest stage-by date first — goods are staged the business day before the truck loads."
        actions={
          <Link href="/floor" className="btn btn-ghost text-sm">
            Status board →
          </Link>
        }
      />

      <div className="card overflow-hidden">
        <div className="p-4 border-b border-border flex items-center gap-3">
          <h2 className="font-semibold">To pick &amp; stage</h2>
          <span className="badge text-muted">{trips.length}</span>
        </div>
        {trips.length === 0 ? (
          <div className="p-10 text-center text-muted">
            No finalized trips waiting. They appear here once a CSR finalizes them.
          </div>
        ) : (
          <ul className="divide-y divide-border/60">
            {trips.map((t) => {
              const stageBy = stagingDateForLoadDate(t.loadDate);
              const overdue = isOverdue(stageBy, today);
              return (
                <li key={t.id}>
                  <Link
                    href={`/staging/${t.id}`}
                    className="flex items-center gap-3 px-4 py-3 flex-wrap hover:bg-surface-2"
                  >
                    <StatusChip status={t.status} />
                    <span className="font-medium">
                      {t.name ?? `Trip · ${isoDate(t.loadDate)}`}
                    </span>
                    <span className="badge text-muted">{TYPE_LABEL[t.type]}</span>
                    {t.lanes.length > 0 && (
                      <span className="text-xs text-teal font-mono">
                        {t.lanes.map((l) => l.lane.code.replace("LANE-", "")).join(", ")}
                      </span>
                    )}
                    <span className="ml-auto flex items-center gap-3 text-xs text-muted">
                      <span>
                        {t._count.orders} {t._count.orders === 1 ? "stop" : "stops"}
                      </span>
                      <span className={overdue ? "text-danger font-semibold" : ""}>
                        stage by {longDate(stageBy)}
                        {overdue ? " · overdue" : ""}
                      </span>
                      <span className="text-muted">loads {longDate(t.loadDate)}</span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
