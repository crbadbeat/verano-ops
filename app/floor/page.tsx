import Link from "next/link";
import { redirect } from "next/navigation";
import { getViewer } from "@/lib/permissions/engine";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { stagingDateForLoadDate, isoDate } from "@/lib/scheduling";
import { isOverdue } from "@/lib/glass";
import PageHeader from "@/components/ui/PageHeader";
import KpiCard from "@/components/ui/KpiCard";
import StatusChip from "@/components/ui/StatusChip";
import type { OrderType, TripStatus } from "@prisma/client";

export const dynamic = "force-dynamic";

const TYPE_LABEL: Record<OrderType, string> = {
  CUSTOMER_DELIVERY: "Delivery",
  TRANSFER: "Transfer",
  SHOW: "Show",
  SERVICE: "Service",
};

// The active pipeline, left to right. Each trip links to the screen where its
// next action happens, so the board doubles as the way into every stage — and
// nothing disappears between "staged" and "delivered" the way it used to.
const STAGES: {
  status: TripStatus;
  label: string;
  href: (id: string) => string;
  preStage: boolean; // stage where a stage-by date can be overdue
  perm?: "qc:signoff" | "dispatch:signoff"; // the permission its target page requires
}[] = [
  { status: "FINALIZED", label: "To lane", href: (id) => `/staging/${id}/confirm`, preStage: true },
  { status: "STAGING", label: "Picking", href: (id) => `/staging/${id}`, preStage: true },
  { status: "STAGED", label: "To QC", href: (id) => `/qc/${id}`, preStage: false, perm: "qc:signoff" },
  { status: "QC_PASSED", label: "To load", href: (id) => `/dispatch/${id}`, preStage: false, perm: "dispatch:signoff" },
  { status: "LOADED", label: "Out for delivery", href: (id) => `/dispatch/${id}`, preStage: false, perm: "dispatch:signoff" },
];

function shortDate(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

type FloorTrip = {
  id: string;
  name: string | null;
  type: OrderType;
  status: TripStatus;
  loadDate: Date;
  _count: { orders: number };
  lanes: { lane: { code: string } }[];
};

function TripCard({
  trip,
  today,
  canQc,
  canDispatch,
}: {
  trip: FloorTrip;
  today: Date;
  canQc: boolean;
  canDispatch: boolean;
}) {
  const stage = STAGES.find((s) => s.status === trip.status)!;
  const stageBy = stagingDateForLoadDate(trip.loadDate);
  const overdue = stage.preStage && isOverdue(stageBy, today);
  const loadingToday = isoDate(trip.loadDate) === isoDate(today);
  const laneCode = trip.lanes[0]?.lane.code.replace("LANE-", "") ?? null;
  // Only link into a stage the viewer can actually work; QC + dispatch redirect
  // non-signoff roles, so a status-board viewer would get bounced to "/". Those
  // cards render static instead.
  const reachable = !stage.perm || (stage.perm === "qc:signoff" ? canQc : canDispatch);

  const body = (
    <>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-medium text-sm truncate">
          {trip.name ?? `Trip · ${isoDate(trip.loadDate)}`}
        </span>
        {laneCode && <span className="badge font-mono text-teal">{laneCode}</span>}
      </div>
      <div className="flex items-center gap-2 flex-wrap text-xs text-muted">
        <span>{TYPE_LABEL[trip.type]}</span>
        <span>·</span>
        <span>
          {trip._count.orders} {trip._count.orders === 1 ? "stop" : "stops"}
        </span>
        <span>·</span>
        <span className={loadingToday ? "text-ember font-semibold" : ""}>
          loads {shortDate(trip.loadDate)}
          {loadingToday ? " (today)" : ""}
        </span>
        {overdue && <span className="text-danger font-semibold">overdue</span>}
      </div>
    </>
  );

  return reachable ? (
    <Link
      href={stage.href(trip.id)}
      className="block rounded-lg border border-border bg-surface-2/40 p-3 hover:border-ember/60 space-y-1"
    >
      {body}
    </Link>
  ) : (
    <div className="rounded-lg border border-border bg-surface-2/40 p-3 space-y-1">{body}</div>
  );
}

export default async function FloorBoardPage() {
  const user = await getViewer();
  if (!can(user, "floor:view")) redirect("/");
  const canQc = can(user, "qc:signoff");
  const canDispatch = can(user, "dispatch:signoff");

  const today = new Date();
  const startOfToday = new Date(`${isoDate(today)}T00:00:00.000Z`);

  const [active, deliveredToday] = await Promise.all([
    prisma.deliveryTrip.findMany({
      where: { status: { in: STAGES.map((s) => s.status) } },
      orderBy: { loadDate: "asc" },
      include: {
        _count: { select: { orders: true } },
        lanes: { orderBy: { position: "asc" }, include: { lane: { select: { code: true } } } },
      },
    }),
    prisma.deliveryTrip.count({
      where: { status: "DELIVERED", deliveredAt: { gte: startOfToday } },
    }),
  ]);

  const byStage = new Map<TripStatus, FloorTrip[]>();
  for (const s of STAGES) byStage.set(s.status, []);
  for (const t of active) byStage.get(t.status)!.push(t);

  const overdueToStage = active.filter(
    (t) =>
      (t.status === "FINALIZED" || t.status === "STAGING") &&
      isOverdue(stagingDateForLoadDate(t.loadDate), today)
  ).length;
  const count = (s: TripStatus) => byStage.get(s)!.length;

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 space-y-8">
      <PageHeader
        title="Warehouse status board"
        description="Every in-flight trip, from finalized to out-for-delivery. Click a trip to work its next step."
        actions={
          <Link href="/staging" className="btn btn-ghost text-sm">
            Pick queue →
          </Link>
        }
      />

      {/* Actionable top line */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <KpiCard
          label="Overdue to stage"
          value={overdueToStage}
          accent={overdueToStage > 0 ? "danger" : "default"}
          href="/staging"
        />
        <KpiCard label="Picking" value={count("STAGING")} href="/staging" />
        <KpiCard label="Awaiting QC" value={count("STAGED")} accent="ember" href={canQc ? "/qc" : undefined} />
        <KpiCard label="To load" value={count("QC_PASSED")} accent="teal" href={canDispatch ? "/dispatch" : undefined} />
        <KpiCard label="Out for delivery" value={count("LOADED")} href={canDispatch ? "/dispatch" : undefined} />
        <KpiCard label="Delivered today" value={deliveredToday} accent="success" />
      </div>

      {/* The pipeline */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        {STAGES.map((s) => {
          const trips = byStage.get(s.status)!;
          return (
            <div key={s.status} className="card p-3 space-y-3">
              <div className="flex items-center gap-2">
                <StatusChip status={s.status} label={s.label} />
                <span className="badge text-muted">{trips.length}</span>
              </div>
              {trips.length === 0 ? (
                <p className="text-xs text-muted px-1 py-3">None.</p>
              ) : (
                <div className="space-y-2">
                  {trips.map((t) => (
                    <TripCard key={t.id} trip={t} today={today} canQc={canQc} canDispatch={canDispatch} />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
