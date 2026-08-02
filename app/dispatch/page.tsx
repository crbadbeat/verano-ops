import Link from "next/link";
import { getViewer } from "@/lib/permissions/engine";
import { redirect } from "next/navigation";

import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { isoDate } from "@/lib/scheduling";
import PageHeader from "@/components/ui/PageHeader";
import StatusChip from "@/components/ui/StatusChip";
import EmptyState from "@/components/ui/EmptyState";
import type { OrderType, TripStatus } from "@prisma/client";

export const dynamic = "force-dynamic";

const TYPE_LABEL: Record<OrderType, string> = {
  CUSTOMER_DELIVERY: "Delivery",
  TRANSFER: "Transfer",
  SHOW: "Show",
  SERVICE: "Service",
};

function longDate(d: Date): string {
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}

type Trip = {
  id: string;
  name: string | null;
  type: OrderType;
  status: TripStatus;
  loadDate: Date;
  _count: { orders: number };
};

function TripList({ trips, empty }: { trips: Trip[]; empty: string }) {
  if (trips.length === 0) return <EmptyState message={empty} />;
  return (
    <ul className="divide-y divide-border/60">
      {trips.map((t) => (
        <li key={t.id}>
          <Link
            href={`/dispatch/${t.id}`}
            className="flex items-center gap-3 px-4 py-3 flex-wrap hover:bg-surface-2"
          >
            <StatusChip status={t.status} />
            <span className="font-medium">{t.name ?? `Trip · ${isoDate(t.loadDate)}`}</span>
            <span className="badge text-muted">{TYPE_LABEL[t.type]}</span>
            <span className="ml-auto flex items-center gap-3 text-xs text-muted">
              <span>
                {t._count.orders} {t._count.orders === 1 ? "stop" : "stops"}
              </span>
              <span>loads {longDate(t.loadDate)}</span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export default async function DispatchQueuePage() {
  const user = await getViewer();
  if (!can(user, "dispatch:signoff")) redirect("/");

  const trips = await prisma.deliveryTrip.findMany({
    where: { status: { in: ["QC_PASSED", "LOADED"] } },
    orderBy: { loadDate: "asc" },
    include: { _count: { select: { orders: true } } },
  });
  const toLoad = trips.filter((t) => t.status === "QC_PASSED");
  const outForDelivery = trips.filter((t) => t.status === "LOADED");

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 space-y-8">
      <PageHeader
        title="Dispatch"
        description="QC-passed trips a driver inspects, signs for and departs — which is when stock finally leaves the warehouse. Loaded trips wait here until they're delivered."
        actions={
          <Link href="/floor" className="btn btn-ghost text-sm">
            Status board →
          </Link>
        }
      />

      <div className="card overflow-hidden">
        <div className="p-4 border-b border-border flex items-center gap-3">
          <h2 className="font-semibold">To load &amp; depart</h2>
          <span className="badge text-muted">{toLoad.length}</span>
        </div>
        <TripList
          trips={toLoad}
          empty="No trips ready to load. They appear here once they pass QC."
        />
      </div>

      <div className="card overflow-hidden">
        <div className="p-4 border-b border-border flex items-center gap-3">
          <h2 className="font-semibold">Out for delivery</h2>
          <span className="badge text-muted">{outForDelivery.length}</span>
        </div>
        <TripList trips={outForDelivery} empty="Nothing on the road right now." />
      </div>
    </div>
  );
}
