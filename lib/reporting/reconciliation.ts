import "server-only";
import { prisma } from "@/lib/db";
import { employeeName } from "@/lib/employees";
import type { DateRange } from "./range";

// -----------------------------------------------------------------------------
// Reconciliation — self-reported PGI SalesEntry vs the canonical NetSuite Order it
// maps to (SalesEntry.matchedOrderId). The matching job isn't built yet, so most
// entries read "unmatched"; this view exists so the moment matches land, the gap
// between what reps reported and what the order book shows is visible + auditable.
// -----------------------------------------------------------------------------

const isoDay = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

export interface ReconRow {
  id: string;
  soldAt: string | null;
  repId: string;
  repName: string;
  customer: string;
  showName: string | null;
  reportedCents: number; // self-reported product total
  matched: boolean;
  orderNo: string | null;
  orderTotalCents: number | null; // the matched order's total (null if unmatched)
  varianceCents: number | null; // order − reported (matched rows only)
  matchedAt: string | null;
}

export interface ReconSummary {
  total: number;
  matched: number;
  unmatched: number;
  reportedCents: number; // all reported
  matchedReportedCents: number; // reported, among matched rows
  matchedOrderCents: number; // order totals, among matched rows
  varianceCents: number; // matchedOrderCents − matchedReportedCents
}

export async function getReconciliation(
  range: DateRange
): Promise<{ rows: ReconRow[]; summary: ReconSummary }> {
  const entries = await prisma.salesEntry.findMany({
    where: { division: "PGI", soldAt: { gte: range.from, lt: range.toExclusive } },
    orderBy: [{ soldAt: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      soldAt: true,
      productTotalCents: true,
      matchedAt: true,
      customerFirst: true,
      customerLast: true,
      salesRepId: true,
      salesRep: { select: { name: true, preferredName: true } },
      showEvent: { select: { name: true } },
      matchedOrder: { select: { orderNo: true, orderTotalCents: true, totalCents: true } },
    },
  });

  const rows: ReconRow[] = entries.map((e) => {
    const matched = e.matchedOrder != null;
    const orderTotalCents = matched
      ? e.matchedOrder!.orderTotalCents ?? e.matchedOrder!.totalCents ?? null
      : null;
    return {
      id: e.id,
      soldAt: isoDay(e.soldAt),
      repId: e.salesRepId,
      repName: employeeName(e.salesRep),
      customer: `${e.customerFirst} ${e.customerLast}`.trim(),
      showName: e.showEvent?.name ?? null,
      reportedCents: e.productTotalCents,
      matched,
      orderNo: e.matchedOrder?.orderNo ?? null,
      orderTotalCents,
      varianceCents: orderTotalCents != null ? orderTotalCents - e.productTotalCents : null,
      matchedAt: isoDay(e.matchedAt),
    };
  });

  const matchedRows = rows.filter((r) => r.matched);
  const matchedReportedCents = matchedRows.reduce((a, r) => a + r.reportedCents, 0);
  const matchedOrderCents = matchedRows.reduce((a, r) => a + (r.orderTotalCents ?? 0), 0);
  const summary: ReconSummary = {
    total: rows.length,
    matched: matchedRows.length,
    unmatched: rows.length - matchedRows.length,
    reportedCents: rows.reduce((a, r) => a + r.reportedCents, 0),
    matchedReportedCents,
    matchedOrderCents,
    varianceCents: matchedOrderCents - matchedReportedCents,
  };

  return { rows, summary };
}
