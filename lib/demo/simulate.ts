import "server-only";
import { prisma } from "@/lib/db";
import type { Prisma } from "@prisma/client";

// -----------------------------------------------------------------------------
// VERANO OPS — DEMO SIMULATOR. One tick = a few new customer orders + a handful
// of self-reported show sales against whatever shows are live today, so the
// dashboards tick up and the TV board fires its sale celebrations for a visitor
// watching. Intra-day growth is lightly pruned; the nightly reset is the real
// bound. Driven over HTTP by a scheduler (Vercel Cron / GitHub Action /
// external), guarded by CRON_SECRET.
// -----------------------------------------------------------------------------

const FIRST = ["James", "Maria", "David", "Ana", "Michael", "Sofia", "Robert", "Lucia", "John", "Elena", "Carlos", "Grace", "Daniel", "Nina", "Peter", "Rosa", "Mark", "Julia", "Tony", "Clara", "Sam", "Diana", "Luke", "Vera", "Omar", "Paula"];
const LAST = ["Reyes", "Nguyen", "Carter", "Silva", "Brooks", "Delgado", "Hughes", "Romano", "Fisher", "Vargas", "Bishop", "Okafor", "Marsh", "Costa", "Pratt", "Ibrahim", "Sloan", "Mendez", "Ford", "Quinn", "Walsh", "Rhodes"];
const DEAL = ["New Deal", "Upgrade/Add On"];
const SALE = ["Grill Island", "Island Bar", "Island Combo", "Appliance Only", "Shades of Verano"];
const SHADES = ["Abaco", "Monaco", "Nassau"];

const pick = <T>(xs: T[]): T => xs[Math.floor(Math.random() * xs.length)];
const int = (lo: number, hi: number) => lo + Math.floor(Math.random() * (hi - lo + 1));
const chance = (p: number) => Math.random() < p;
const cust = () => ({ first: pick(FIRST), last: pick(LAST) });

const MAX_SALES_ENTRIES = 600;

export async function runSimulateTick(): Promise<Record<string, number>> {
  const now = new Date();

  const showrooms = await prisma.location.findMany({
    where: { type: "WAREHOUSE", isDefaultWarehouse: false, netsuiteSalesCenterId: { not: null } },
    select: { id: true, netsuiteSalesCenterId: true },
  });
  const bases = await prisma.product.findMany({ where: { category: "Base", pickable: true }, select: { id: true, sku: true } });
  const pickables = await prisma.product.findMany({ where: { pickable: true }, select: { id: true, sku: true }, take: 40 });
  const pgdReps = await prisma.employee.findMany({ where: { salesLevel: "REP", divisions: { some: { division: "PGD" } } }, select: { id: true, divisions: { select: { netsuiteId: true } } } });
  const pgiReps = await prisma.employee.findMany({ where: { divisions: { some: { division: "PGI" } } }, select: { id: true } });
  const pgiUser = await prisma.user.findFirst({ where: { role: "PGI_SALES" }, select: { id: true } });

  if (!showrooms.length || !bases.length || !pgdReps.length) {
    return { note: 0, ordersCreated: 0, salesCreated: 0 };
  }

  // active shows: date window overlaps [today-3, today+1] (same as the board)
  const lo = new Date(now.getTime() - 3 * 86400000);
  const hi = new Date(now.getTime() + 1 * 86400000);
  const activeShows = await prisma.showEvent.findMany({
    where: { status: { not: "CANCELLED" }, dates: { some: { startDate: { lte: hi }, endDate: { gte: lo } } } },
    select: { id: true, leaderEmployeeId: true },
  });

  // --- new customer orders (PGD, MANUAL so they bypass the deposit gate) ------
  const stamp = Math.floor(now.getTime() / 1000);
  let ordersCreated = 0;
  const nOrders = int(1, 3);
  for (let i = 0; i < nOrders; i++) {
    const sr = pick(showrooms);
    const rep = pick(pgdReps);
    const c = cust();
    const base = pick(bases);
    const total = int(600000, 2600000);
    const status = chance(0.6) ? "CONFIRMED" : "DRAFT";
    const lineProducts = [base, pick(pickables), pick(pickables)];
    await prisma.order.create({
      data: {
        orderNo: `SO${stamp}${i}`,
        source: "MANUAL",
        status: status as Prisma.OrderCreateInput["status"],
        type: "CUSTOMER_DELIVERY",
        division: "PGD",
        customerFirst: c.first,
        customerLast: c.last,
        salesRepName: `${pick(FIRST)} ${pick(LAST)}`,
        salesCenterId: sr.netsuiteSalesCenterId,
        salesRep1Id: rep.divisions[0]?.netsuiteId ?? null,
        purchasedAt: now,
        totalCents: total,
        subtotalCents: Math.round(total * 0.92),
        salesTaxCents: Math.round(total * 0.07),
        depositReceivedCents: chance(0.7) ? Math.round(total * (0.5 + Math.random() * 0.5)) : 0,
        islands: { create: { role: "GRILL", styleCode: base.sku.split("-")[0], attributes: {} } },
        lines: { create: lineProducts.map((p) => ({ productId: p.id, sku: p.sku, qty: 1, origin: "MANUAL" as const })) },
        events: { create: { type: "CREATED", summary: "Simulated order" } },
      },
    });
    ordersCreated++;
  }

  // --- new show sales (PGI) against active shows → TV board celebrations ------
  let salesCreated = 0;
  const seRows: Prisma.SalesEntryCreateManyInput[] = [];
  for (const show of activeShows) {
    const n = int(1, 4);
    for (let k = 0; k < n; k++) {
      if (!pgiReps.length) break;
      const rep = pick(pgiReps);
      const c = cust();
      const saleType = pick(SALE);
      const isShades = saleType === "Shades of Verano";
      seRows.push({
        division: "PGI",
        salesRepId: rep.id,
        showEventId: show.id,
        showLeaderId: show.leaderEmployeeId,
        customerFirst: c.first,
        customerLast: c.last,
        dealType: pick(DEAL),
        saleType,
        priceList: "2026 Retail",
        productTotalCents: int(500000, 2600000),
        pflFeeCents: chance(0.4) ? int(20000, 60000) : null,
        grillIsland: isShades ? null : pick(["GX10", "GX12", "GX14", "MONACO", "ARUBA", "MAUI"]),
        shadesOfVerano: isShades ? pick(SHADES) : null,
        soldAt: now,
        enteredById: pgiUser?.id ?? null,
      });
      salesCreated++;
    }
  }
  if (seRows.length) await prisma.salesEntry.createMany({ data: seRows });

  // --- light prune so intra-day growth stays bounded (nightly reset is the real bound) ---
  const seTotal = await prisma.salesEntry.count();
  let pruned = 0;
  if (seTotal > MAX_SALES_ENTRIES) {
    const oldest = await prisma.salesEntry.findMany({ orderBy: { createdAt: "asc" }, take: seTotal - MAX_SALES_ENTRIES, select: { id: true } });
    const res = await prisma.salesEntry.deleteMany({ where: { id: { in: oldest.map((r) => r.id) } } });
    pruned = res.count;
  }

  return { ordersCreated, salesCreated, activeShows: activeShows.length, prunedSales: pruned };
}
