import Link from "next/link";
import { getViewer } from "@/lib/permissions/engine";
import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { costTotals } from "@/lib/events";
import { salesByShow } from "@/lib/reporting/shows";
import { employeeName } from "@/lib/employees";
import PageHeader from "@/components/ui/PageHeader";
import EventsExplorer, { type ExplorerShow } from "@/components/events/EventsExplorer";
import EventsTabs from "@/components/events/EventsTabs";
import ToastOnParam from "@/components/ui/ToastOnParam";

export const dynamic = "force-dynamic";

const iso = (d: Date) => d.toISOString().slice(0, 10);
// Clock read kept out of the component render (server components stay pure).
function currentIso(): string {
  return new Date().toISOString().slice(0, 10);
}

type ViewParam = "list" | "month" | "week";
const asView = (v: string | undefined): ViewParam | null =>
  v === "list" || v === "month" || v === "week" ? v : null;

export default async function EventsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const me = await getViewer();
  if (!can(me, "events:view")) notFound();
  const canEdit = can(me, "events:edit");

  // Initial view: an explicit URL ?view= wins (Back / deep link); otherwise the
  // last view the user chose, remembered in a cookie (survives a nav-menu visit
  // to the bare /events). Read on the server so SSR + hydration agree — no flash.
  const sp = await searchParams;
  const cookieView = asView((await cookies()).get("events_view")?.value);
  const initialView: ViewParam = asView(sp.view) ?? cookieView ?? "list";

  const events = await prisma.showEvent.findMany({
    orderBy: [{ createdAt: "desc" }],
    include: {
      dates: { select: { startDate: true, endDate: true } },
      costs: { select: { budgetCents: true, actualCents: true } },
      leader: { select: { name: true, firstName: true, lastName: true, preferredName: true } },
      promoter: { select: { name: true } },
      _count: { select: { staff: true } },
    },
  });

  const sales = await salesByShow();
  const shows: ExplorerShow[] = events.map((e) => {
    const totals = costTotals(e.costs);
    return {
      id: e.id,
      name: e.name,
      status: e.status,
      city: e.city,
      state: e.state,
      venueName: e.venueName,
      promoterName: e.promoter?.name ?? null,
      leaderName: e.leader ? employeeName(e.leader) : null,
      staffCount: e._count.staff,
      repsNeeded: e.repsNeeded,
      goalCents: e.goalCents,
      salesCents: sales.get(e.id)?.salesCents ?? 0,
      budgetCents: totals.budget,
      actualCents: totals.actual,
      spans: e.dates.map((d) => ({ start: iso(d.startDate), end: iso(d.endDate) })),
    };
  });

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 space-y-8">
      <ToastOnParam map={{ deleted: "Show deleted" }} />
      <PageHeader
        eyebrow="PGI"
        title="Shows & events"
        description="Home shows, boat shows and the like the direct sales teams work — dates, costs, staffing, goals and (later) the sales they drive."
        actions={
          canEdit ? (
            <>
              <Link href="/events/series" className="btn btn-ghost text-sm">Series</Link>
              <Link href="/events/promoters" className="btn btn-ghost text-sm">Promoters</Link>
              <Link href="/events/new" className="btn btn-primary text-sm">New show</Link>
            </>
          ) : undefined
        }
      />
      <EventsTabs />

      {shows.length === 0 ? (
        <div className="card p-8 text-center text-muted text-sm">
          No shows yet.
          {canEdit && (
            <>
              {" "}
              <Link href="/events/new" className="text-teal hover:underline">Create one →</Link>
            </>
          )}
        </div>
      ) : (
        <EventsExplorer shows={shows} todayIso={currentIso()} initialView={initialView} />
      )}
    </div>
  );
}
