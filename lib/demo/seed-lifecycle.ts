import "server-only";
import { prisma } from "@/lib/db";

// -----------------------------------------------------------------------------
// VERANO OPS — LIFECYCLE SEED. Populates the operational pipeline in EVERY stage
// so the whole app can be explored end to end: orders in every status, delivery
// trips through the full pick -> stage -> QC -> dispatch -> deliver chain,
// transfers, returns, glass mods, manufacturing (jobs/mods/a void) and physical
// counts. Every inventory movement is written as InventoryLedger rows exactly the
// way the server actions write them (reason / sign / location / condition / tag),
// so on-hand stays derivable and non-negative.
//
// Runs AFTER the base seed (lib/demo/seed-demo.ts) inside runDemoSeed on a fresh
// DB, so it re-queries the base entities and needs no clear step. Dates are
// relative to "now" so the board always looks current across nightly reseeds.
// -----------------------------------------------------------------------------

// 1px placeholder signature (data URL)
const SIG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

function cursor<T>(pool: T[]): () => T {
  let i = 0;
  return () => pool[i++ % pool.length];
}
/** even split of cents across N workers, odd cent(s) to the first. */
function bonusShares(rateCents: number, n: number): number[] {
  const r = Math.max(0, Math.round(rateCents));
  if (n <= 1) return [r];
  const base = Math.floor(r / n);
  const rem = r - base * n;
  return Array.from({ length: n }, (_, i) => base + (i < rem ? 1 : 0));
}
/** parse an 11-segment base SKU into the grammar-keyed attributes object. */
function baseAttrs(sku: string): Record<string, string> {
  const s = String(sku).split("-");
  const keys = ["style", "grillHole", "burner", "accessDoors", "fridges", "drawerTrash", "warming", "audio", "led", "footRail", "siding"];
  const a: Record<string, string> = { color: "VOL", tiki: "N", sink: "N", umbrella: "N", gasType: "LP" };
  keys.forEach((k, i) => (a[k] = s[i] ?? ""));
  if (!a.style) a.style = s[0] || "GX10";
  return a;
}

export async function seedLifecycle(): Promise<Record<string, number>> {
  const summary: Record<string, number> = {};
  const bump = (k: string, n = 1) => (summary[k] = (summary[k] || 0) + n);

  const now = new Date();
  const startOfDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const day = (n: number) => new Date(startOfDay.getTime() + n * 86400000);
  const TODAY = now;
  /** 2 business days before a load date (UTC), mirrors lib/glass.ts. */
  function dueDateForLoadDate(load: Date): Date {
    const d = new Date(load);
    let left = 2;
    while (left > 0) {
      d.setUTCDate(d.getUTCDate() - 1);
      const dow = d.getUTCDay();
      if (dow !== 0 && dow !== 6) left--;
    }
    return d;
  }

  // --- reference data (re-query what the base seed created) ------------------
  const users = await prisma.user.findMany({ select: { id: true, role: true, name: true } });
  const byRole: Record<string, { id: string; role: string; name: string | null }> = {};
  for (const u of users) if (!byRole[u.role]) byRole[u.role] = u;
  const U = (r: string) => (byRole[r] || byRole.ADMIN).id;
  const ADMIN = U("ADMIN");
  const SALES = U("SALES");
  const CSR = U("CSR");
  const STAFF = U("STAFF");
  const RETURNS = U("RETURNS");
  const WATERJET = U("WATERJET");
  const MFG = U("MFG_MANAGER");
  const driverUser = byRole.DRIVER || byRole.ADMIN;

  const ocoee = (await prisma.location.findFirst({ where: { isDefaultWarehouse: true }, select: { id: true, code: true } }))!;
  const showrooms = await prisma.location.findMany({
    where: { type: "WAREHOUSE", isDefaultWarehouse: false, isStagingLane: false, code: { not: "IN-TRANSIT" } },
    select: { id: true, code: true, name: true },
    take: 4,
  });
  const lanes = await prisma.location.findMany({ where: { isStagingLane: true, code: { startsWith: "LANE-0" } }, select: { id: true, code: true }, orderBy: { code: "asc" } });
  const bins = await prisma.location.findMany({ where: { type: "BIN", parentId: ocoee.id, isStagingLane: false }, select: { id: true, code: true }, orderBy: { code: "desc" }, take: 60 });
  const inTransit = (await prisma.location.findFirst({ where: { code: "IN-TRANSIT" }, select: { id: true } }))!;

  const basesRaw = await prisma.product.findMany({ where: { sku: { contains: "-" }, active: true }, select: { id: true, sku: true }, take: 200 });
  const bases = basesRaw.filter((b) => b.sku.split("-").length >= 11);
  const glass = await prisma.product.findMany({ where: { category: "Glass", active: true }, select: { id: true, sku: true }, take: 60 });
  const appliances = await prisma.product.findMany({ where: { category: "Appliances", active: true, pickable: true }, select: { id: true, sku: true, name: true }, take: 60 });

  const nextBase = cursor(bases);
  const nextGlass = cursor(glass);
  const nextAppl = cursor(appliances);
  const nextLane = cursor(lanes);
  const nextBin = cursor(bins);
  const nextShowroom = cursor(showrooms.length ? showrooms : [{ id: ocoee.id, code: ocoee.code, name: "Ocoee" }]);

  const CITIES: [string, string, string][] = [
    ["Boynton Beach", "FL", "33426"], ["Naples", "FL", "34102"], ["Tampa", "FL", "33602"],
    ["Orlando", "FL", "32801"], ["Sarasota", "FL", "34236"], ["Jupiter", "FL", "33458"],
    ["Fort Lauderdale", "FL", "33301"], ["Winter Park", "FL", "32789"],
  ];
  const FIRST = ["Jane", "Marcus", "Priya", "Liam", "Sofia", "Noah", "Ava", "Ethan", "Mia", "Lucas", "Chloe", "Diego"];
  const LAST = ["Doe", "Reyes", "Patel", "Nguyen", "Rossi", "Baker", "Kim", "Turner", "Silva", "Walsh", "Owens", "Frost"];
  const nc = cursor(CITIES);
  const nf = cursor(FIRST);
  const nl = cursor(LAST);

  let orderSeq = 3000;
  const nextOrderNo = () => `VSEED-${++orderSeq}`;

  // ledger writer + prerequisite stock (so depletions never go negative)
  const ledger = (data: Record<string, unknown>) =>
    prisma.inventoryLedger.create({ data: { condition: "NEW", ...data } as never });
  const seedStock = (productId: string, locationId: string | null, qty: number, createdById: string) =>
    ledger({ productId, locationId, qtyDelta: qty, reason: "SEED", note: "[SEED-STOCK] lifecycle starting stock", createdById });

  // === 1. MANUFACTURING SETUP =================================================
  const empDefs: [string, string][] = [
    ["Miguel Santos", "W-01"], ["Andre Johnson", "W-02"], ["Hector Ramirez", "W-03"],
    ["Tyrell Banks", "W-04"], ["Devon Clarke", "W-05"], ["Rosa Delgado", "W-06"],
  ];
  const employees = [];
  for (const [name, code] of empDefs) {
    employees.push(await prisma.employee.upsert({ where: { code }, update: { name, active: true }, create: { name, code } }));
  }
  const styleDefs: [string, string][] = [["GX10", "GX-10"], ["GX08", "GX-08"], ["GX12", "GX-12"], ["MA10", "Maui 10"], ["ARB6", "Aruba 6"], ["STC8", "St. Croix 8"]];
  const STAGES = ["WELDING", "BOARDING", "STUCCO", "ELECTRICAL", "WRAPPING"];
  const baseRates: Record<string, number> = { WELDING: 1500, BOARDING: 1200, STUCCO: 2000, ELECTRICAL: 1000, WRAPPING: 805 };
  const styles: Record<string, { id: string }> = {};
  for (const [code, name] of styleDefs) {
    const st = await prisma.baseStyle.upsert({ where: { code }, update: { name, active: true }, create: { code, name } });
    styles[code] = st;
    for (const stage of STAGES) {
      const amt = baseRates[stage] + (code === "MA10" ? 300 : code === "ARB6" ? -200 : 0);
      await prisma.bonusRate.upsert({ where: { baseStyleId_stage: { baseStyleId: st.id, stage: stage as never } }, update: { amountCents: amt }, create: { baseStyleId: st.id, stage: stage as never, amountCents: amt } });
    }
  }
  const modReasons: { id: string }[] = [];
  for (const label of ["Customer config change", "Wrong grill hole", "Damage repair", "Upgrade — add fridge"]) {
    let mr = await prisma.modReason.findFirst({ where: { label } });
    if (!mr) mr = await prisma.modReason.create({ data: { label } });
    modReasons.push(mr);
  }
  const bomBases = [bases[0], bases[1]];
  const bomMap = new Map<string, { componentId: string; qty: number }[]>();
  for (const bb of bomBases) {
    const comps = [nextAppl(), nextAppl(), nextAppl()].map((c, i) => ({ componentId: c.id, qty: [1, 3, 2][i] })).filter((c) => c.componentId !== bb.id);
    for (const c of comps) {
      await prisma.bomComponent.upsert({ where: { productId_componentId: { productId: bb.id, componentId: c.componentId } }, update: { qty: c.qty }, create: { productId: bb.id, componentId: c.componentId, qty: c.qty } });
    }
    bomMap.set(bb.id, comps);
  }
  bump("mfgEmployees", employees.length);

  // === 2. ORDERS (islands + lines; no ledger) =================================
  type OrderOpts = {
    status?: string; type?: string; source?: string; fraud?: boolean; twoIslands?: boolean;
    createdById?: string; taxFree?: boolean; veranoForLife?: boolean; gasType?: string;
    payments?: { method: string; amountCents: number; reference?: string }[]; deliveryTripId?: string | null; loadDate?: Date | null;
  };
  async function makeOrder(opts: OrderOpts = {}) {
    const { status = "DRAFT", type = "CUSTOMER_DELIVERY", source = "MANUAL", fraud = false, twoIslands = false, createdById = SALES, taxFree = false, veranoForLife = false, gasType = "LP", payments = [], deliveryTripId = null, loadDate = null } = opts;
    const [bCity, bState, bZip] = nc();
    const [dCity, dState, dZip] = fraud ? nc() : [bCity, bState, bZip];
    const first = nf(), last = nl();
    const orderNo = nextOrderNo();
    const order = await prisma.order.create({
      data: {
        orderNo, posOrderNo: orderNo.replace("VSEED-", ""), source: source as never, status: status as never, type: type as never,
        customerFirst: first, customerLast: last, email: `${first}.${last}@example.com`.toLowerCase(), phone: "555-0100", cell: "555-0199",
        billingAddress: "100 Palm Ave", billingCity: bCity, billingState: bState, billingZip: bZip,
        deliveryAddress: fraud ? "742 Evergreen Terrace" : "100 Palm Ave", deliveryCity: dCity, deliveryState: dState, deliveryZip: dZip,
        gallery: `${bCity}, ${bState}`, salesRepName: "Showroom Sales", gtlId: "GTL-42", repId: "REP-7",
        purchasedAt: day(-20), requestedTimeframe: "3-6 WEEKS", gasType: gasType as never, taxFree,
        veranoForLife, veranoForLifeTier: veranoForLife ? "Founders" : null,
        subtotalCents: 4200000, salesTaxCents: taxFree ? 0 : 294000, freightCents: 65000, totalCents: taxFree ? 4265000 : 4559000,
        downPaymentCents: 1000000, balanceDueCents: 3559000, fraudCheckStatus: fraud ? "REQUIRED" : "NOT_REQUIRED",
        note: "[SEED] lifecycle order", deliveryTripId, loadDate, createdById,
      },
    });
    const base = nextBase(); const top = nextGlass();
    const gIsland = await prisma.orderIsland.create({ data: { orderId: order.id, position: 0, role: "GRILL", styleCode: base.sku.split("-")[0], grillPosition: "double", attributes: baseAttrs(base.sku), baseSku: base.sku, baseProductId: base.id, topSku: top.sku, topProductId: top.id } });
    const islandLines: Record<string, unknown>[] = [
      { islandId: gIsland.id, origin: "CONFIG_BASE", productId: base.id, sku: base.sku, rawLabel: base.sku, qty: 1 },
      { islandId: gIsland.id, origin: "CONFIG_TOP", productId: top.id, sku: top.sku, rawLabel: top.sku, qty: 1 },
    ];
    for (let i = 0; i < 2; i++) { const a = nextAppl(); islandLines.push({ islandId: gIsland.id, origin: "CONFIG_ITEM", productId: a.id, sku: a.sku, rawLabel: a.name, qty: 1 }); }
    if (twoIslands) {
      const bBase = nextBase(); const bTop = nextGlass();
      const bIsland = await prisma.orderIsland.create({ data: { orderId: order.id, position: 1, role: "BAR", styleCode: bBase.sku.split("-")[0], grillPosition: null, attributes: baseAttrs(bBase.sku), baseSku: bBase.sku, baseProductId: bBase.id, topSku: bTop.sku, topProductId: bTop.id } });
      islandLines.push({ islandId: bIsland.id, origin: "CONFIG_BASE", productId: bBase.id, sku: bBase.sku, rawLabel: bBase.sku, qty: 1 }, { islandId: bIsland.id, origin: "CONFIG_TOP", productId: bTop.id, sku: bTop.sku, rawLabel: bTop.sku, qty: 1 });
    }
    await prisma.orderLine.createMany({ data: islandLines.map((l) => ({ orderId: order.id, ...l })) as never });
    for (const pm of payments) await prisma.orderPayment.create({ data: { orderId: order.id, method: pm.method as never, amountCents: pm.amountCents, reference: pm.reference ?? null, receivedAt: day(-18), createdById } });
    await prisma.orderEvent.create({ data: { orderId: order.id, type: "CREATED", summary: "Order created (seed)", userId: createdById } });
    bump("orders");
    return order;
  }

  for (let i = 0; i < 6; i++) await makeOrder({ status: "DRAFT", twoIslands: i % 2 === 0 });
  for (let i = 0; i < 8; i++) await makeOrder({ status: "CONFIRMED", twoIslands: i % 3 === 0, fraud: i === 1, taxFree: i === 2, veranoForLife: i === 3, gasType: i % 2 ? "NG" : "LP", payments: i % 2 ? [{ method: "CHECK", amountCents: 1000000, reference: "CHK-" + i }] : [{ method: "CREDIT_CARD", amountCents: 1000000, reference: "AUTH-" + i }] });
  for (let i = 0; i < 5; i++) await makeOrder({ status: "CANCELLED" });

  // === 3. DELIVERY TRIPS through the full chain ===============================
  let tripSeq = 0;
  async function scheduledOrderForTrip(trip: { id: string; type: string; name: string; loadDate: Date | null }) {
    const o = await makeOrder({ status: "SCHEDULED", type: trip.type, deliveryTripId: trip.id, loadDate: trip.loadDate });
    await prisma.orderEvent.create({ data: { orderId: o.id, type: "SCHEDULED", summary: `Scheduled onto trip ${trip.name}`, userId: CSR } });
    return o;
  }
  async function pickablesForTrip(tripId: string) {
    const rows = await prisma.orderLine.groupBy({ by: ["productId"], where: { order: { deliveryTripId: tripId }, productId: { not: null }, product: { pickable: true } }, _sum: { qty: true } });
    return rows.map((r) => ({ productId: r.productId as string, qty: r._sum.qty || 0 })).filter((r) => r.qty > 0);
  }
  async function createTrip({ status, type = "CUSTOMER_DELIVERY", loadDate, area, withOrder = true, shortfall = false }: { status: string; type?: string; loadDate: Date; area: string; withOrder?: boolean; shortfall?: boolean }) {
    tripSeq++;
    const name = `[SEED] ${type === "TRANSFER" ? "Transfer" : type === "SHOW" ? "Show" : "Delivery"} #${tripSeq} — ${area}`;
    const trip = await prisma.deliveryTrip.create({ data: { name, type: type as never, status: "PLANNING", loadDate, area, createdById: CSR } });
    bump("trips");
    if (withOrder) await scheduledOrderForTrip({ id: trip.id, type, name, loadDate });
    const rank = ["PLANNING", "FINALIZED", "STAGING", "STAGED", "QC_PASSED", "LOADED", "DELIVERED"].indexOf(status);
    const patch: Record<string, unknown> = {};
    if (rank >= 1) patch.finalizedAt = TODAY;
    let primaryLane: { id: string } | null = null;
    if (rank >= 2) {
      primaryLane = nextLane(); const l2 = nextLane();
      await prisma.deliveryTripLane.create({ data: { tripId: trip.id, laneId: primaryLane.id, position: 0 } });
      if (l2.id !== primaryLane.id) await prisma.deliveryTripLane.create({ data: { tripId: trip.id, laneId: l2.id, position: 1 } });
    }
    const staged: { productId: string; qty: number }[] = [];
    if (rank >= 2 && primaryLane) {
      const picks = await pickablesForTrip(trip.id);
      for (let i = 0; i < picks.length; i++) {
        const p = picks[i]; const bin = nextBin();
        await seedStock(p.productId, bin.id, p.qty * 3, STAFF);
        const pickQty = shortfall && i === picks.length - 1 ? Math.max(0, p.qty - 1) : p.qty;
        if (pickQty > 0) {
          await ledger({ productId: p.productId, locationId: bin.id, qtyDelta: -pickQty, reason: "PICK", note: "[SEED] Picked from " + bin.code, tripId: trip.id, createdById: STAFF });
          await ledger({ productId: p.productId, locationId: primaryLane.id, qtyDelta: pickQty, reason: "PICK", note: "[SEED] Staged to lane", tripId: trip.id, createdById: STAFF });
          staged.push({ productId: p.productId, qty: pickQty });
        }
      }
    }
    if (rank >= 2) patch.status = "STAGING";
    if (rank >= 3) { patch.status = "STAGED"; patch.stagedAt = TODAY; patch.stagedById = STAFF; }
    if (rank >= 4) { patch.status = "QC_PASSED"; patch.qcById = ADMIN; patch.qcAt = TODAY; patch.qcNote = "[SEED] QC pass — looks good"; }
    if (rank >= 5 && primaryLane) {
      for (const s of staged) await ledger({ productId: s.productId, locationId: primaryLane.id, qtyDelta: -s.qty, reason: "SHIPMENT", note: "[SEED] Departed — " + name, tripId: trip.id, createdById: driverUser.id });
      patch.status = "LOADED"; patch.driverId = driverUser.role === "DRIVER" ? driverUser.id : null; patch.driverName = driverUser.name || "Driver"; patch.signatureData = SIG; patch.signedAt = TODAY; patch.departedAt = TODAY;
    }
    if (rank >= 6) { patch.status = "DELIVERED"; patch.deliveredById = driverUser.id; patch.deliveredAt = TODAY; }
    if (Object.keys(patch).length) await prisma.deliveryTrip.update({ where: { id: trip.id }, data: patch as never });
    return trip;
  }
  await createTrip({ status: "PLANNING", loadDate: day(10), area: "South FL", withOrder: false });
  await createTrip({ status: "PLANNING", loadDate: day(11), area: "Central FL" });
  await createTrip({ status: "FINALIZED", loadDate: day(3), area: "Tampa Bay" });
  await createTrip({ status: "FINALIZED", loadDate: day(4), area: "Orlando" });
  await createTrip({ status: "STAGING", loadDate: day(1), area: "Naples" });
  await createTrip({ status: "STAGING", loadDate: day(2), area: "Jupiter", shortfall: true });
  await createTrip({ status: "STAGED", loadDate: day(0), area: "Sarasota" });
  await createTrip({ status: "STAGED", loadDate: day(0), area: "Boca" });
  await createTrip({ status: "QC_PASSED", loadDate: day(0), area: "Miami" });
  await createTrip({ status: "LOADED", loadDate: day(-1), area: "Palm Beach" });
  await createTrip({ status: "DELIVERED", loadDate: day(-3), area: "Fort Myers" });
  await createTrip({ status: "DELIVERED", loadDate: day(-4), area: "Stuart" });
  {
    const t = await createTrip({ status: "PLANNING", loadDate: day(14), area: "Cancelled run" });
    await prisma.order.updateMany({ where: { deliveryTripId: t.id }, data: { deliveryTripId: null, status: "CONFIRMED", loadDate: null } });
    await prisma.deliveryTrip.update({ where: { id: t.id }, data: { status: "CANCELLED" } });
  }
  await createTrip({ status: "FINALIZED", type: "SHOW", loadDate: day(8), area: "Home Show — Expo" });
  await createTrip({ status: "FINALIZED", type: "TRANSFER", loadDate: day(9), area: "Transfer to West DC" });

  // === 4. TRANSFERS ===========================================================
  async function makeTransfer({ state, dest }: { state: string; dest: { id: string; code: string } }) {
    const ref = `[SEED] XFER-${dest.code}`;
    const t = await prisma.transfer.create({ data: { reference: ref, destWarehouseId: dest.id, createdById: STAFF } });
    bump("transfers");
    const lineProducts = [nextAppl(), nextAppl(), nextBase()];
    const lines: { productId: string; qty: number }[] = [];
    for (const lp of lineProducts) { const qty = 2; await prisma.transferLine.create({ data: { transferId: t.id, productId: lp.id, itemLabel: lp.sku, qty } }); lines.push({ productId: lp.id, qty }); }
    if (state === "STAGED") return;
    for (const l of lines) {
      await seedStock(l.productId, null, l.qty * 2, STAFF);
      await ledger({ productId: l.productId, locationId: null, qtyDelta: -l.qty, reason: "TRANSFER_OUT", note: "[SEED] Transfer departed — " + ref, transferId: t.id, createdById: STAFF });
      await ledger({ productId: l.productId, locationId: inTransit.id, qtyDelta: l.qty, reason: "TRANSFER_IN", note: "[SEED] In transit — " + ref, transferId: t.id, createdById: STAFF });
    }
    await prisma.transfer.update({ where: { id: t.id }, data: { status: "IN_TRANSIT", driverName: "Driver", signatureData: SIG, signedAt: TODAY, departedAt: TODAY } });
    if (state === "IN_TRANSIT") return;
    for (const l of lines) {
      await ledger({ productId: l.productId, locationId: inTransit.id, qtyDelta: -l.qty, reason: "TRANSFER_OUT", note: "[SEED] Received at " + dest.code, transferId: t.id, createdById: STAFF });
      await ledger({ productId: l.productId, locationId: dest.id, qtyDelta: l.qty, reason: "TRANSFER_IN", note: "[SEED] Received at " + dest.code, transferId: t.id, createdById: STAFF });
    }
    await prisma.transfer.update({ where: { id: t.id }, data: { status: "RECEIVED", receivedAt: TODAY, receivedById: STAFF } });
  }
  for (const s of ["STAGED", "STAGED", "IN_TRANSIT", "IN_TRANSIT", "RECEIVED", "RECEIVED"]) await makeTransfer({ state: s, dest: nextShowroom() });
  {
    const dest = nextShowroom();
    const t = await prisma.transfer.create({ data: { reference: "[SEED] XFER-CANCELLED", destWarehouseId: dest.id, createdById: STAFF } });
    await prisma.transferLine.create({ data: { transferId: t.id, productId: nextAppl().id, itemLabel: "cancelled line", qty: 1 } });
    await prisma.transfer.update({ where: { id: t.id }, data: { status: "CANCELLED" } });
    bump("transfers");
  }

  // === 5. RETURNS =============================================================
  let retSeq = 4000;
  async function makeReturn({ state }: { state: string }) {
    const ref = `[SEED] RET-${++retSeq}`;
    const r = await prisma.returnOrder.create({ data: { reference: ref, reason: "Delivery no-show", createdById: RETURNS } });
    bump("returns");
    const lps = [nextAppl(), nextAppl()];
    const lines: { id: string; productId: string; expectedQty: number }[] = [];
    for (const lp of lps) { const expectedQty = 4; const line = await prisma.returnOrderLine.create({ data: { returnOrderId: r.id, productId: lp.id, itemLabel: lp.sku, expectedQty } }); lines.push({ id: line.id, productId: lp.id, expectedQty }); }
    const checkIn = async (line: { id: string; productId: string }, qty: number) => {
      await prisma.returnOrderLine.update({ where: { id: line.id }, data: { checkedInQty: { increment: qty } } });
      await ledger({ productId: line.productId, locationId: null, qtyDelta: qty, reason: "RETURN", note: "[SEED] Return check-in — " + ref, returnOrderId: r.id, createdById: RETURNS });
    };
    if (state === "FLAGGED") return;
    if (state === "PARTIAL") { await checkIn(lines[0], 2); return; }
    if (state === "CHECKED_IN") { for (const l of lines) await checkIn(l, l.expectedQty); await prisma.returnOrder.update({ where: { id: r.id }, data: { status: "CHECKED_IN", checkedInAt: TODAY, checkedInById: RETURNS } }); return; }
    if (state === "SHORTFALL") { await checkIn(lines[0], 3); await prisma.returnOrder.update({ where: { id: r.id }, data: { status: "CHECKED_IN", checkedInAt: TODAY, checkedInById: RETURNS } }); return; }
    if (state === "CANCELLED") { await prisma.returnOrder.update({ where: { id: r.id }, data: { status: "CANCELLED" } }); return; }
  }
  for (const s of ["FLAGGED", "FLAGGED", "PARTIAL", "PARTIAL", "CHECKED_IN", "CHECKED_IN", "SHORTFALL", "SHORTFALL", "CANCELLED"]) await makeReturn({ state: s });

  // === 6. GLASS MODS (waterjet queue) =========================================
  let gSeq = 5000;
  async function makeGlassMod({ state, loadDate }: { state: string; loadDate: Date }) {
    let source = nextGlass(), target = nextGlass();
    while (target.id === source.id) target = nextGlass();
    const dueDate = dueDateForLoadDate(loadDate);
    const gm = await prisma.glassMod.create({ data: { orderNo: "VSEED-G" + ++gSeq, customer: `${nf()} ${nl()}`, loadDate, dueDate, sourceProductId: source.id, targetProductId: target.id, qty: 1, note: "[SEED] glass cut job", requestedById: CSR } });
    bump("glassMods");
    if (state === "QUEUED") return;
    if (state === "IN_PROGRESS") { await prisma.glassMod.update({ where: { id: gm.id }, data: { status: "IN_PROGRESS", startedAt: TODAY } }); return; }
    if (state === "COMPLETED") {
      await seedStock(source.id, null, 3, WATERJET);
      await ledger({ productId: source.id, locationId: null, qtyDelta: -1, reason: "MOD_OUT", note: "[SEED] Glass mod — cut " + source.sku, glassModId: gm.id, createdById: WATERJET });
      await ledger({ productId: target.id, locationId: null, qtyDelta: 1, reason: "MOD_IN", note: "[SEED] Glass mod — produced " + target.sku, glassModId: gm.id, createdById: WATERJET });
      await prisma.glassMod.update({ where: { id: gm.id }, data: { status: "COMPLETED", startedAt: TODAY, completedAt: TODAY, completedById: WATERJET } });
      return;
    }
    if (state === "CANCELLED") { await prisma.glassMod.update({ where: { id: gm.id }, data: { status: "CANCELLED" } }); return; }
  }
  await makeGlassMod({ state: "QUEUED", loadDate: day(8) });
  await makeGlassMod({ state: "QUEUED", loadDate: day(-6) });
  await makeGlassMod({ state: "QUEUED", loadDate: day(-5) });
  await makeGlassMod({ state: "IN_PROGRESS", loadDate: day(3) });
  await makeGlassMod({ state: "IN_PROGRESS", loadDate: day(5) });
  await makeGlassMod({ state: "COMPLETED", loadDate: day(-8) });
  await makeGlassMod({ state: "COMPLETED", loadDate: day(-10) });
  await makeGlassMod({ state: "CANCELLED", loadDate: day(16) });

  // === 7. MANUFACTURING (jobs at each stage, mods, a void) ====================
  const styleCodes = Object.keys(styles);
  const nStyle = cursor(styleCodes);
  async function makeJob({ stage, workers, product }: { stage: string; workers: { id: string }[]; product: { id: string; sku: string } }) {
    const st = styles[nStyle()];
    const rate = await prisma.bonusRate.findUnique({ where: { baseStyleId_stage: { baseStyleId: st.id, stage: stage as never } } });
    const rateCents = rate?.amountCents ?? 0;
    const shares = bonusShares(rateCents, workers.length);
    const entry = await prisma.manufacturingEntry.create({ data: { kind: "JOB", productId: product.id, baseStyleId: st.id, stage: stage as never, split: workers.length > 1, bonusRateCents: rateCents, note: "[SEED] job", createdById: MFG, pays: { create: workers.map((w, i) => ({ employeeId: w.id, amountCents: shares[i] })) } } });
    bump("mfgEntries");
    if (stage === "WRAPPING") {
      await ledger({ productId: product.id, qtyDelta: 1, reason: "MANUFACTURE", note: "[SEED] Wrapped — built " + product.sku, manufacturingEntryId: entry.id, createdById: MFG });
      for (const c of bomMap.get(product.id) || []) { await seedStock(c.componentId, null, c.qty * 2, MFG); await ledger({ productId: c.componentId, qtyDelta: -c.qty, reason: "CONSUME", note: "[SEED] Consumed building " + product.sku, manufacturingEntryId: entry.id, createdById: MFG }); }
    }
    return entry;
  }
  await makeJob({ stage: "WELDING", workers: [employees[0]], product: nextBase() });
  await makeJob({ stage: "BOARDING", workers: [employees[1], employees[2]], product: nextBase() });
  await makeJob({ stage: "STUCCO", workers: [employees[3]], product: nextBase() });
  await makeJob({ stage: "ELECTRICAL", workers: [employees[0], employees[4]], product: nextBase() });
  await makeJob({ stage: "WRAPPING", workers: [employees[1], employees[5]], product: bomBases[0] });
  await makeJob({ stage: "WRAPPING", workers: [employees[2]], product: bomBases[1] });

  async function makeMod({ workers }: { workers: { id: string }[] }) {
    let orig = nextBase(), result = nextBase();
    while (result.id === orig.id) result = nextBase();
    const st = styles[nStyle()];
    const rate = await prisma.bonusRate.findUnique({ where: { baseStyleId_stage: { baseStyleId: st.id, stage: "WELDING" } } });
    const rateCents = rate?.amountCents ?? 0;
    const shares = bonusShares(rateCents, workers.length);
    const entry = await prisma.manufacturingEntry.create({ data: { kind: "MOD", productId: orig.id, newProductId: result.id, baseStyleId: st.id, stage: "WELDING", modReasonId: modReasons[0].id, split: workers.length > 1, bonusRateCents: rateCents, note: "[SEED] mod", createdById: MFG, pays: { create: workers.map((w, i) => ({ employeeId: w.id, amountCents: shares[i] })) } } });
    bump("mfgEntries");
    await seedStock(orig.id, null, 2, MFG);
    await ledger({ productId: orig.id, qtyDelta: -1, reason: "MOD_OUT", note: "[SEED] Mod — deducted " + orig.sku, manufacturingEntryId: entry.id, createdById: MFG });
    await ledger({ productId: result.id, qtyDelta: 1, reason: "MOD_IN", note: "[SEED] Mod — added " + result.sku, manufacturingEntryId: entry.id, createdById: MFG });
    return entry;
  }
  await makeMod({ workers: [employees[0]] });
  const modToVoid = await makeMod({ workers: [employees[1], employees[2]] });
  {
    const rows = await prisma.inventoryLedger.findMany({ where: { manufacturingEntryId: modToVoid.id, reason: { in: ["MOD_OUT", "MOD_IN"] } } });
    for (const l of rows) await ledger({ productId: l.productId, locationId: l.locationId, qtyDelta: -l.qtyDelta, reason: "REVERSAL", note: "[SEED] Voided manufacturing entry", manufacturingEntryId: modToVoid.id, createdById: MFG });
    await prisma.manufacturingEntry.update({ where: { id: modToVoid.id }, data: { voided: true, voidedById: MFG, voidedAt: TODAY } });
  }

  // === 8. PHYSICAL COUNTS =====================================================
  async function makeCount({ state, type = "FULL" }: { state: string; type?: string }) {
    const label = `[SEED] ${ocoee.code} ${type === "CYCLE" ? "cycle" : "full"} — ${state.toLowerCase()}`;
    const session = await prisma.countSession.create({ data: { label, warehouseId: ocoee.id, type: type as never, status: "OPEN", createdById: ADMIN } });
    bump("countSessions");
    const slots: { productId: string; locationId: string; derived: number; counted: number }[] = [];
    for (let i = 0; i < 3; i++) {
      const p = nextAppl(); const bin = nextBin(); const base = 10;
      await seedStock(p.id, bin.id, base, ADMIN);
      const counted = base + [-2, 3, 0][i];
      await prisma.countEntry.create({ data: { sessionId: session.id, locationId: bin.id, productId: p.id, qty: counted, method: "SCAN", countedById: ADMIN } });
      slots.push({ productId: p.id, locationId: bin.id, derived: base, counted });
    }
    if (state === "OPEN") return;
    if (state === "REVIEW") { await prisma.countSession.update({ where: { id: session.id }, data: { status: "REVIEW" } }); return; }
    if (state === "CANCELLED") { await prisma.countSession.update({ where: { id: session.id }, data: { status: "CANCELLED" } }); return; }
    if (state === "POSTED") {
      for (const s of slots) { const delta = s.counted - s.derived; if (delta !== 0) await ledger({ productId: s.productId, locationId: s.locationId, qtyDelta: delta, reason: "COUNT", note: `[SEED] Count "${label}" set on-hand to ${s.counted}`, countSessionId: session.id, createdById: ADMIN }); }
      await prisma.countSession.update({ where: { id: session.id }, data: { status: "POSTED", postedById: ADMIN, postedAt: TODAY } });
      return;
    }
  }
  await makeCount({ state: "OPEN" });
  await makeCount({ state: "OPEN", type: "CYCLE" });
  await makeCount({ state: "REVIEW" });
  await makeCount({ state: "REVIEW", type: "CYCLE" });
  await makeCount({ state: "POSTED" });
  await makeCount({ state: "POSTED", type: "CYCLE" });
  await makeCount({ state: "CANCELLED" });

  return summary;
}
