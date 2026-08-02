import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getViewer } from "@/lib/permissions/engine";
import { can, ROLE_LABEL } from "@/lib/rbac";
import { visibleNav } from "@/lib/nav";
import PageHeader from "@/components/ui/PageHeader";
import KpiCard, { type KpiAccent } from "@/components/ui/KpiCard";

export const dynamic = "force-dynamic";

type Tile = {
  label: string;
  value: number;
  accent?: KpiAccent;
  href?: string;
  show: boolean;
};

/**
 * The Home Router. Every role lands here on login and sees a Today view tailored
 * to what they do: a picker sees floor work, a CSR sees the order pipeline, a
 * manager sees both. Purpose-built per-role dashboards replace this over the
 * coming waves; today it is one role-aware surface, derived live from the ledger
 * and order book.
 */
export default async function Home() {
  const user = await getViewer();
  if (!user) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-10">
        <p className="text-muted">
          Please <Link href="/login" className="underline">sign in</Link>.
        </p>
      </div>
    );
  }

  // PGI sales reps have a single job in the app — logging sales — so send them
  // straight to the entry form instead of the shared Today view (which would be
  // empty for them anyway). Mirrors the EXECUTIVE redirect in /dashboard.
  if (user.role === "PGI_SALES") redirect("/sales-entry/new");

  const [
    activeProducts,
    unscheduled,
    fraudQueue,
    tripsToPick,
    tripsPicking,
    tripsAwaitingQc,
    openCounts,
    glassQueue,
    returnsWaiting,
    inTransit,
  ] = await Promise.all([
    prisma.product.count({ where: { active: true } }),
    prisma.order.count({ where: { status: "CONFIRMED", deliveryTripId: null } }),
    prisma.order.count({ where: { fraudCheckStatus: "REQUIRED" } }),
    prisma.deliveryTrip.count({ where: { status: "FINALIZED" } }),
    prisma.deliveryTrip.count({ where: { status: "STAGING" } }),
    prisma.deliveryTrip.count({ where: { status: "STAGED" } }),
    prisma.countSession.count({ where: { status: { in: ["OPEN", "REVIEW"] } } }),
    prisma.glassMod.count({ where: { status: { in: ["QUEUED", "IN_PROGRESS"] } } }),
    prisma.returnOrder.count({ where: { status: "FLAGGED" } }),
    prisma.transfer.count({ where: { status: "IN_TRANSIT" } }),
  ]);

  const tiles: Tile[] = [
    { label: "Orders to schedule", value: unscheduled, accent: "ember", href: "/scheduling", show: can(user, "orders:schedule") },
    { label: "Fraud checks waiting", value: fraudQueue, accent: fraudQueue > 0 ? "danger" : "default", href: "/orders?fraud=1", show: can(user, "orders:manage") },
    { label: "Trips to pick", value: tripsToPick, accent: "ember", href: "/staging", show: can(user, "staging:pick") },
    { label: "Picking now", value: tripsPicking, accent: "ember", href: "/staging", show: can(user, "staging:pick") },
    { label: "Awaiting QC", value: tripsAwaitingQc, accent: "teal", href: "/staging", show: can(user, "staging:mark") },
    { label: "Open counts", value: openCounts, accent: "ember", href: "/count", show: can(user, "count:enter") },
    { label: "Glass to cut", value: glassQueue, accent: "ember", href: "/glass", show: can(user, "glass:execute") },
    { label: "Returns to check in", value: returnsWaiting, accent: "ember", href: "/returns", show: can(user, "returns:edit") },
    { label: "In transit", value: inTransit, accent: "ember", href: "/transfers", show: can(user, "transfers:edit") },
    { label: "Active SKUs", value: activeProducts, href: "/inventory", show: can(user, "inventory:view") },
  ];
  const shown = tiles.filter((tile) => tile.show);

  const jumpGroups = visibleNav(user).filter((group) => group.id !== "TODAY");

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 space-y-10">
      <PageHeader
        eyebrow={ROLE_LABEL[user.role]}
        title={`Welcome${user.name ? `, ${user.name}` : ""}.`}
        description="Here's what needs attention across the operation right now."
      />

      {shown.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {shown.map((tile) => (
            <KpiCard
              key={tile.label}
              label={tile.label}
              value={tile.value}
              accent={tile.accent}
              href={tile.href}
            />
          ))}
        </div>
      )}

      <div className="space-y-3">
        <h2 className="text-sm font-mono uppercase tracking-widest text-muted">Jump back in</h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {jumpGroups.map((group) => (
            <div key={group.id} className="card p-5">
              <h3 className="font-semibold">{group.label}</h3>
              <div className="mt-3 flex flex-wrap gap-2">
                {group.items.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="btn btn-ghost py-1.5 px-3 text-sm"
                  >
                    {item.label}
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
