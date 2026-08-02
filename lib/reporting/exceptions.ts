import "server-only";
import { prisma } from "@/lib/db";
import { isOverdue } from "@/lib/glass";
import { stagingDateForLoadDate } from "@/lib/scheduling";
import { isoDate } from "./range";
import { siteLedgerWhere, type SiteScope } from "./scope";

// -----------------------------------------------------------------------------
// The exceptions board: everything at risk of missing a truck or corrupting the
// numbers, assembled from the pages a manager would otherwise have to check one
// by one. Current-state (no time window); inventory checks honour the site scope.
// -----------------------------------------------------------------------------

export interface ExceptionItem {
  id: string;
  label: string;
  detail?: string;
  href?: string;
}

export interface ExceptionGroup {
  key: string;
  title: string;
  tone: "danger" | "ember" | "muted";
  blurb: string;
  count: number;
  items: ExceptionItem[];
}

export async function getExceptions(scope: SiteScope, now: Date): Promise<ExceptionGroup[]> {
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  const [
    slots,
    finalizedOpen,
    glassOpen,
    fraud,
    unmatchedOrderLines,
    unmatchedTransferLines,
    unmatchedCountEntries,
    netsuiteUnlinked,
  ] = await Promise.all([
    prisma.inventoryLedger.groupBy({
      by: ["productId", "locationId", "condition"],
      where: siteLedgerWhere(scope),
      _sum: { qtyDelta: true },
    }),
    prisma.deliveryTrip.findMany({
      where: { status: "FINALIZED", stagedAt: null },
      select: { id: true, name: true, loadDate: true },
    }),
    prisma.glassMod.findMany({
      where: { status: { in: ["QUEUED", "IN_PROGRESS"] } },
      select: { id: true, orderNo: true, dueDate: true },
    }),
    prisma.order.findMany({
      where: { fraudCheckStatus: "REQUIRED" },
      select: { id: true, orderNo: true, customerLast: true },
      take: 50,
    }),
    prisma.orderLine.count({ where: { productId: null } }),
    prisma.transferLine.count({ where: { productId: null } }),
    prisma.countEntry.count({ where: { productId: null } }),
    prisma.product.count({ where: { netsuiteLinkedAt: null, active: true } }),
  ]);

  const negatives = slots.filter((s) => (s._sum.qtyDelta ?? 0) < 0);
  const negIds = [...new Set(negatives.map((s) => s.productId))];
  const negProducts = negIds.length
    ? await prisma.product.findMany({ where: { id: { in: negIds } }, select: { id: true, sku: true } })
    : [];
  const skuById = new Map(negProducts.map((p) => [p.id, p.sku]));

  const overdueTrips = finalizedOpen.filter((t) =>
    isOverdue(stagingDateForLoadDate(t.loadDate), today)
  );
  const overdueGlass = glassOpen.filter((g) => isOverdue(g.dueDate, today));
  const unmatchedTotal = unmatchedOrderLines + unmatchedTransferLines + unmatchedCountEntries;

  return [
    {
      key: "negative",
      title: "Negative on-hand slots",
      tone: "danger",
      blurb: "A bin/condition is below zero — a data-integrity break to reconcile.",
      count: negatives.length,
      items: negatives.slice(0, 25).map((s) => ({
        id: `${s.productId}-${s.locationId ?? "wh"}-${s.condition}`,
        label: skuById.get(s.productId) ?? s.productId,
        detail: `${s._sum.qtyDelta} · ${s.condition}`,
        href: `/inventory/${s.productId}`,
      })),
    },
    {
      key: "stageby",
      title: "Overdue to stage",
      tone: "danger",
      blurb: "Finalized trips whose stage-by date has passed, still unstaged.",
      count: overdueTrips.length,
      items: overdueTrips.slice(0, 25).map((t) => ({
        id: t.id,
        label: t.name ?? `Trip ${t.id.slice(0, 6)}`,
        detail: `loads ${isoDate(t.loadDate)}`,
        href: `/staging/${t.id}`,
      })),
    },
    {
      key: "glass",
      title: "Overdue glass cuts",
      tone: "ember",
      blurb: "Queued waterjet jobs past due (2 business days before load).",
      count: overdueGlass.length,
      items: overdueGlass.slice(0, 25).map((g) => ({
        id: g.id,
        label: g.orderNo ?? `Cut ${g.id.slice(0, 6)}`,
        detail: g.dueDate ? `due ${isoDate(g.dueDate)}` : undefined,
        href: "/glass",
      })),
    },
    {
      key: "fraud",
      title: "Fraud checks waiting",
      tone: "ember",
      blurb: "Orders whose billing ≠ delivery address, blocking scheduling.",
      count: fraud.length,
      items: fraud.slice(0, 25).map((o) => ({
        id: o.id,
        label: o.orderNo,
        detail: o.customerLast ?? undefined,
        href: `/orders/${o.id}`,
      })),
    },
    {
      key: "unmatched",
      title: "Unmatched lines",
      tone: "muted",
      blurb: "Lines not yet resolved to a product — map them so they count.",
      count: unmatchedTotal,
      items: [
        { id: "ol", label: "Order lines", detail: String(unmatchedOrderLines), href: "/orders" },
        { id: "tl", label: "Transfer lines", detail: String(unmatchedTransferLines), href: "/transfers" },
        { id: "ce", label: "Count entries", detail: String(unmatchedCountEntries), href: "/count" },
      ].filter((x) => Number(x.detail) > 0),
    },
    {
      key: "netsuite",
      title: "NetSuite-unlinked products",
      tone: "muted",
      blurb: "Active products without a NetSuite number — tie them off in the queue.",
      count: netsuiteUnlinked,
      items:
        netsuiteUnlinked > 0
          ? [
              {
                id: "ns",
                label: "Products without a NetSuite number",
                detail: String(netsuiteUnlinked),
                href: "/inventory/netsuite-queue",
              },
            ]
          : [],
    },
  ];
}
