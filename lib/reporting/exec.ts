import "server-only";
import { prisma } from "@/lib/db";
import { FEE_FREE_METHODS, type PaymentMethodCode } from "@/lib/order-payments";
import { isoDate, eachDay, type DateRange } from "./range";

// -----------------------------------------------------------------------------
// Executive cockpit metrics — bookings, cash, pipeline, production, and
// inventory position for the whole company. Windowed figures use the order/
// payment timestamps; balances (AR, pipeline, position) are current-state.
// -----------------------------------------------------------------------------

const PIPELINE_ORDER = [
  "DRAFT",
  "CONFIRMED",
  "SCHEDULED",
  "STAGED",
  "SHIPPED",
  "DELIVERED",
] as const;

export interface ExecMetrics {
  bookingsCents: number;
  bookingsCount: number;
  pflCount: number;
  cashCents: number;
  arCents: number;
  feeFreeCents: number;
  feeBearingCents: number;
  paymentMix: { method: PaymentMethodCode; cents: number }[];
  pipeline: { status: string; count: number }[];
  unitsBuilt: number;
  fraudBacklog: number;
  onHandUnits: number;
  negativeSlots: number;
  bookingsByDay: { label: string; value: number }[]; // dollars
  unitsBuiltByDay: { label: string; value: number }[];
}

export async function getExecMetrics(range: DateRange): Promise<ExecMetrics> {
  const days = eachDay(range);

  const [orders, payments, totalBooked, totalPaid, pipelineGroups, wrapEntries, fraudBacklog, onHandAgg, slots] =
    await Promise.all([
      prisma.order.findMany({
        // Operational cockpit: the analytics-only historical backfill is excluded
        // (it lives in the Sales dashboard). Operational orders are isHistorical:false.
        where: { isHistorical: false, purchasedAt: { gte: range.from, lt: range.toExclusive } },
        select: { totalCents: true, purchasedAt: true, veranoForLife: true },
      }),
      prisma.orderPayment.findMany({
        where: { receivedAt: { gte: range.from, lt: range.toExclusive } },
        select: { amountCents: true, method: true },
      }),
      prisma.order.aggregate({
        _sum: { totalCents: true },
        where: { isHistorical: false, status: { not: "CANCELLED" } },
      }),
      prisma.orderPayment.aggregate({ _sum: { amountCents: true } }),
      prisma.order.groupBy({ by: ["status"], _count: { _all: true }, where: { isHistorical: false } }),
      prisma.manufacturingEntry.findMany({
        where: {
          kind: "JOB",
          stage: "WRAPPING",
          voided: false,
          createdAt: { gte: range.from, lt: range.toExclusive },
        },
        select: { createdAt: true },
      }),
      prisma.order.count({ where: { isHistorical: false, fraudCheckStatus: "REQUIRED" } }),
      prisma.inventoryLedger.aggregate({ _sum: { qtyDelta: true } }),
      prisma.inventoryLedger.groupBy({
        by: ["productId", "locationId", "condition"],
        _sum: { qtyDelta: true },
      }),
    ]);

  let bookingsCents = 0;
  let pflCount = 0;
  const bookingsByDay = new Map<string, number>();
  for (const order of orders) {
    bookingsCents += order.totalCents ?? 0;
    if (order.veranoForLife) pflCount++;
    if (order.purchasedAt) {
      const key = isoDate(order.purchasedAt);
      bookingsByDay.set(key, (bookingsByDay.get(key) ?? 0) + Math.round((order.totalCents ?? 0) / 100));
    }
  }

  let cashCents = 0;
  let feeFreeCents = 0;
  let feeBearingCents = 0;
  const byMethod = new Map<PaymentMethodCode, number>();
  for (const payment of payments) {
    const method = payment.method as PaymentMethodCode;
    cashCents += payment.amountCents;
    byMethod.set(method, (byMethod.get(method) ?? 0) + payment.amountCents);
    if (FEE_FREE_METHODS.includes(method)) feeFreeCents += payment.amountCents;
    else feeBearingCents += payment.amountCents;
  }

  const arCents = (totalBooked._sum.totalCents ?? 0) - (totalPaid._sum.amountCents ?? 0);

  const pipelineCounts = new Map<string, number>();
  for (const group of pipelineGroups) pipelineCounts.set(group.status, group._count._all);
  const pipeline = PIPELINE_ORDER.map((status) => ({
    status,
    count: pipelineCounts.get(status) ?? 0,
  }));

  const unitsBuiltByDay = new Map<string, number>();
  for (const entry of wrapEntries) {
    const key = isoDate(entry.createdAt);
    unitsBuiltByDay.set(key, (unitsBuiltByDay.get(key) ?? 0) + 1);
  }

  const negativeSlots = slots.filter((s) => (s._sum.qtyDelta ?? 0) < 0).length;

  return {
    bookingsCents,
    bookingsCount: orders.length,
    pflCount,
    cashCents,
    arCents,
    feeFreeCents,
    feeBearingCents,
    paymentMix: [...byMethod.entries()]
      .map(([method, cents]) => ({ method, cents }))
      .sort((a, b) => b.cents - a.cents),
    pipeline,
    unitsBuilt: wrapEntries.length,
    fraudBacklog,
    onHandUnits: onHandAgg._sum.qtyDelta ?? 0,
    negativeSlots,
    bookingsByDay: days.map((d) => ({ label: d.slice(5), value: bookingsByDay.get(d) ?? 0 })),
    unitsBuiltByDay: days.map((d) => ({ label: d.slice(5), value: unitsBuiltByDay.get(d) ?? 0 })),
  };
}
