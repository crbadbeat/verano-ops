import "server-only";
import { prisma } from "@/lib/db";
import { hashPassword } from "@/lib/auth";
import { seedPermissions } from "@/lib/permissions/seed";
import { ensureStagingLanes, ensureInTransit } from "@/lib/locations";
import { seedLifecycle } from "./seed-lifecycle";
import type { Prisma } from "@prisma/client";

// -----------------------------------------------------------------------------
// VERANO OPS — DEMO SEED (from empty).
//
// Builds a complete, believable dataset for the public portfolio demo: one
// distribution center with bins + staging lanes, a network of showrooms grouped
// into regions, a synthetic product catalog, an employee roster with an org
// chart across both divisions, logins spanning every role (so the permissions
// system + "view as" demo work), inventory placed into bins, a backlog of orders
// across the whole lifecycle (plus historical orders for dashboard depth), and
// live shows with self-reported sales so the TV board lights up on first load.
//
// This function is the reset primitive too: it TRUNCATEs every public table
// (CASCADE) first, so the nightly cron simply re-runs it to heal any demo mess.
// Everything runs server-side (proper @/ alias + server-only lib resolution).
// -----------------------------------------------------------------------------

// Deterministic-ish RNG so a reseed looks stable but varied.
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20260802);
const pick = <T>(xs: T[]): T => xs[Math.floor(rnd() * xs.length)];
const int = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));
const chance = (p: number) => rnd() < p;
const daysAgo = (n: number, base = Date.now()) => new Date(base - n * 86400000);
const chunk = <T>(xs: T[], n: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
};

const FIRST = ["James", "Maria", "David", "Ana", "Michael", "Sofia", "Robert", "Lucia", "John", "Elena", "Carlos", "Grace", "Daniel", "Nina", "Peter", "Rosa", "Mark", "Julia", "Tony", "Clara", "Sam", "Diana", "Luke", "Vera", "Omar", "Paula", "Ivan", "Tara", "Leo", "Mia"];
const LAST = ["Reyes", "Nguyen", "Carter", "Silva", "Brooks", "Delgado", "Hughes", "Romano", "Fisher", "Vargas", "Bishop", "Okafor", "Marsh", "Costa", "Pratt", "Ibrahim", "Sloan", "Mendez", "Ford", "Quinn", "Walsh", "Rhodes", "Frye", "Novak", "Pace"];
const CITY_ST: [string, string][] = [
  ["Orlando", "FL"], ["Tampa", "FL"], ["Fort Myers", "FL"], ["Naples", "FL"], ["Sarasota", "FL"],
  ["Jacksonville", "FL"], ["Boca Raton", "FL"], ["West Palm Beach", "FL"], ["Miami", "FL"], ["Fort Lauderdale", "FL"],
  ["Savannah", "GA"], ["Charleston", "SC"],
];

type CreatedEmp = { id: string; code: string; num: string; division: "PGI" | "PGD"; salesLevel: string | null };

export type DemoSeedSummary = Record<string, string | number>;

export async function runDemoSeed(): Promise<DemoSeedSummary> {
  // --- 0) WIPE everything (CASCADE handles FK order) --------------------------
  const tables: { tablename: string }[] = await prisma.$queryRawUnsafe(
    `SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename NOT LIKE '\\_prisma%'`
  );
  if (tables.length) {
    const list = tables.map((t) => `"public"."${t.tablename}"`).join(", ");
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
  }

  // --- 1) LOCATIONS -----------------------------------------------------------
  const mainWh = await prisma.location.create({
    data: { code: "VDC", name: "Verano Distribution Center", type: "WAREHOUSE", isDefaultWarehouse: true, netsuiteId: 1 },
  });

  // bin grid: aisles 1..6, bays A..C, levels 1..2
  const binData: Prisma.LocationCreateManyInput[] = [];
  for (let a = 1; a <= 6; a++)
    for (const bay of ["A", "B", "C"])
      for (let lvl = 1; lvl <= 2; lvl++)
        binData.push({ code: `${a}-${bay}-${lvl}`, name: `Aisle ${a} · ${bay}${lvl}`, type: "BIN", parentId: mainWh.id });
  await prisma.location.createMany({ data: binData });
  const bins = await prisma.location.findMany({ where: { type: "BIN", isStagingLane: false, parentId: mainWh.id } });

  await ensureStagingLanes();
  await ensureInTransit();

  // showrooms (WAREHOUSE, region assigned below)
  const showroomDefs = CITY_ST.map(([city, st], i) => ({
    code: `SR-${city.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 6)}`,
    name: `${city} Showroom`,
    city,
    state: st,
    netsuiteSalesCenterId: 100 + i,
  }));
  const showrooms = [];
  for (const s of showroomDefs) {
    showrooms.push(
      await prisma.location.create({
        data: { code: s.code, name: s.name, type: "WAREHOUSE", isDefaultWarehouse: false, netsuiteSalesCenterId: s.netsuiteSalesCenterId },
      })
    );
  }

  // --- 2) REGIONS (regionalId patched after employees) ------------------------
  const regionNames = ["Central Florida", "Gulf Coast", "Atlantic Coast", "Southeast"];
  const regions = [];
  for (const name of regionNames) regions.push(await prisma.region.create({ data: { name } }));
  // assign showrooms round-robin to regions
  for (let i = 0; i < showrooms.length; i++) {
    await prisma.location.update({ where: { id: showrooms[i].id }, data: { regionId: regions[i % regions.length].id } });
  }

  // --- 3) PRODUCTS ------------------------------------------------------------
  const products: { id: string; sku: string; category: string; pickable: boolean }[] = [];
  let nsNum = 2000;
  const addProduct = async (sku: string, name: string, category: string, costCents: number, pickable = true) => {
    const p = await prisma.product.create({
      data: { sku, name, displayName: name, category, netsuiteNumber: String(nsNum++), standardCostCents: costCents, pickable },
    });
    products.push({ id: p.id, sku, category, pickable });
    return p;
  };
  // Bases: 11-segment SKUs so they read as real configured bases
  const baseStyles = ["GX10", "GX12", "GX14", "MONACO", "ARUBA", "MAUI", "TAHITI", "BIMINI"];
  for (const style of baseStyles) {
    const sku = [style, "H", "4B", "2D", "1F", "1T", "W", "A", "L", "R", "S"].join("-");
    await addProduct(sku, `${style} Grill Island Base`, "Base", int(180000, 420000));
  }
  // Glass tops
  for (const style of baseStyles.slice(0, 6)) await addProduct(`GLASS-${style}`, `${style} Glass Top`, "Glass", int(40000, 90000));
  // Appliances
  const appliances = ["36\" Gas Grill", "Side Burner", "Outdoor Fridge", "Ice Bin", "Warming Drawer", "Kegerator", "Pizza Oven", "Vent Hood", "Sink Module", "Storage Drawer"];
  for (const a of appliances) await addProduct(`APP-${a.replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 8)}`, a, "Appliances", int(30000, 260000));
  // Bars, fire pits, shades
  for (const b of ["Aruba Tiki Bar", "Maui Swim-Up Bar", "Bimini Bar"]) await addProduct(`BAR-${b.split(" ")[0].toUpperCase()}`, b, "Bar", int(220000, 500000));
  for (const f of ["48\" Fire Pit", "Linear Fire Table"]) await addProduct(`FIRE-${f.replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 8)}`, f, "Fire", int(90000, 180000));
  for (const s of ["Abaco Shades", "Monaco Shades", "Nassau Shades"]) await addProduct(`SHADE-${s.split(" ")[0].toUpperCase()}`, s, "Shades", int(60000, 140000));

  const bases = products.filter((p) => p.category === "Base");
  const pickables = products.filter((p) => p.pickable);

  // --- 4) EMPLOYEES + divisions + assignments (two-pass for managerId) --------
  const created: CreatedEmp[] = [];
  let dSeq = 100;
  let iSeq = 100;
  const mkName = () => `${pick(FIRST)} ${pick(LAST)}`;
  const makeEmp = async (opts: {
    division: "PGI" | "PGD";
    salesLevel?: string | null;
    title: string;
    homeLocationId?: string | null;
    regionId?: string | null;
  }) => {
    const num = opts.division === "PGD" ? String(dSeq++) : String(iSeq++);
    const code = (opts.division === "PGD" ? "D" : "I") + num;
    const name = mkName();
    const first = name.split(" ")[0];
    const last = name.split(" ")[1];
    const emp = await prisma.employee.create({
      data: {
        name,
        firstName: first,
        lastName: last,
        code,
        title: opts.title,
        salesLevel: (opts.salesLevel as Prisma.EmployeeCreateInput["salesLevel"]) ?? null,
        homeLocationId: opts.homeLocationId ?? null,
        regionId: opts.regionId ?? null,
        hireDate: daysAgo(int(200, 1800)),
        divisions: { create: { division: opts.division, divisionCode: code, netsuiteId: num } },
        assignments: { create: { effectiveDate: daysAgo(int(200, 1800)), salesLevel: (opts.salesLevel as Prisma.EmployeeAssignmentCreateInput["salesLevel"]) ?? null, homeLocationId: opts.homeLocationId ?? null, regionId: opts.regionId ?? null } },
      },
    });
    created.push({ id: emp.id, code, num, division: opts.division, salesLevel: opts.salesLevel ?? null });
    return emp;
  };

  // PGD sales org: VPs -> Regionals (1/region) -> GTLs (1/showroom) -> Reps
  const vps = [await makeEmp({ division: "PGD", salesLevel: "VP", title: "VP of Sales", homeLocationId: showrooms[0].id }), await makeEmp({ division: "PGD", salesLevel: "VP", title: "VP of Sales", homeLocationId: showrooms[1].id })];
  const regionals = [];
  for (let i = 0; i < regions.length; i++) {
    const home = showrooms.find((s) => true)!;
    const r = await makeEmp({ division: "PGD", salesLevel: "REGIONAL", title: "Regional Manager", homeLocationId: showrooms[i].id, regionId: regions[i].id });
    regionals.push(r);
    await prisma.region.update({ where: { id: regions[i].id }, data: { regionalId: r.id } });
    await prisma.employee.update({ where: { id: r.id }, data: { managerId: vps[i % vps.length].id } });
  }
  const gtls: Record<string, string> = {}; // showroomId -> gtl empId
  for (let i = 0; i < showrooms.length; i++) {
    const region = regions[i % regions.length];
    const g = await makeEmp({ division: "PGD", salesLevel: "GTL", title: "Showroom Manager (GTL)", homeLocationId: showrooms[i].id, regionId: region.id });
    gtls[showrooms[i].id] = g.id;
    const regional = regionals[i % regionals.length];
    await prisma.employee.update({ where: { id: g.id }, data: { managerId: regional.id } });
  }
  const pgdReps: CreatedEmp[] = [];
  for (let i = 0; i < 20; i++) {
    const sr = showrooms[i % showrooms.length];
    const region = regions[i % regions.length];
    const rep = await makeEmp({ division: "PGD", salesLevel: "REP", title: "Sales Representative", homeLocationId: sr.id, regionId: region.id });
    await prisma.employee.update({ where: { id: rep.id }, data: { managerId: gtls[sr.id] } });
    pgdReps.push(created[created.length - 1]);
  }

  // PGI show org: leaders + reps
  const showLeaders: CreatedEmp[] = [];
  for (let i = 0; i < 3; i++) {
    await makeEmp({ division: "PGI", salesLevel: "GTL", title: "Show Leader", homeLocationId: mainWh.id });
    showLeaders.push(created[created.length - 1]);
  }
  const pgiReps: CreatedEmp[] = [];
  for (let i = 0; i < 12; i++) {
    await makeEmp({ division: "PGI", salesLevel: "REP", title: "Show Sales Rep", homeLocationId: mainWh.id });
    pgiReps.push(created[created.length - 1]);
  }

  // Ops staff (no sales level)
  const opsTitles = ["Warehouse Associate", "Warehouse Associate", "Picker/Packer", "Glass Waterjet Tech", "Returns Specialist", "Delivery Driver", "Delivery Driver", "CSR / Scheduler", "CSR / Scheduler", "Accounting Clerk", "Manufacturing Lead"];
  for (const t of opsTitles) await makeEmp({ division: "PGD", title: t, homeLocationId: mainWh.id });

  // --- 5) USERS + role assignments + permissions ------------------------------
  const empByIdx = (n: number) => created[n];
  const adminEmail = "crbadbeat@hotmail.com";
  const demoEmail = "guest@veranooutdoor.com";
  const users: { email: string; role: string; name: string; empId?: string; password: string; mustReset?: boolean }[] = [
    { email: adminEmail, role: "ADMIN", name: "Chris (Owner)", password: "verano-admin-2026" },
    // Guest gets broad operator (MANAGER) access so a visitor can explore orders,
    // scheduling, inventory + the floor. The destructive/admin surfaces (user &
    // permission management, hub reset) stay ADMIN-only, and the nightly reset
    // heals anything a guest changes.
    { email: demoEmail, role: "MANAGER", name: "Demo Guest", password: "guestdemo" },
    { email: "manager@veranooutdoor.com", role: "MANAGER", name: "Ops Manager", password: "demo1234", empId: empByIdx(created.length - 1).id },
    { email: "csr@veranooutdoor.com", role: "CSR", name: "CSR / Scheduler", password: "demo1234" },
    { email: "sales@veranooutdoor.com", role: "SALES", name: "Showroom Sales", password: "demo1234", empId: pgdReps[0].id },
    { email: "accounting@veranooutdoor.com", role: "ACCOUNTING", name: "Accounting", password: "demo1234" },
    { email: "mfg@veranooutdoor.com", role: "MFG_MANAGER", name: "Manufacturing Lead", password: "demo1234" },
    { email: "driver@veranooutdoor.com", role: "DRIVER", name: "Delivery Driver", password: "demo1234" },
    { email: "returns@veranooutdoor.com", role: "RETURNS", name: "Returns Specialist", password: "demo1234" },
    { email: "waterjet@veranooutdoor.com", role: "WATERJET", name: "Waterjet Tech", password: "demo1234" },
    { email: "exec@veranooutdoor.com", role: "EXECUTIVE", name: "Executive", password: "demo1234" },
    { email: "pgisales@veranooutdoor.com", role: "PGI_SALES", name: "Show Rep", password: "demo1234", empId: pgiReps[0].id },
    { email: "staff@veranooutdoor.com", role: "STAFF", name: "Warehouse Staff", password: "demo1234" },
  ];
  for (const u of users) {
    const created0 = await prisma.user.create({
      data: {
        email: u.email,
        name: u.name,
        role: u.role as Prisma.UserCreateInput["role"],
        active: true,
        mustResetPassword: u.mustReset ?? false,
        passwordHash: await hashPassword(u.password),
        roleAssignments: { create: { role: u.role as Prisma.UserRoleAssignmentCreateInput["role"] } },
      },
    });
    if (u.empId) await prisma.employee.update({ where: { id: u.empId }, data: { userId: created0.id } });
  }
  const perm = await seedPermissions();

  // --- 6) SETTINGS ------------------------------------------------------------
  await prisma.setting.upsert({ where: { id: "current" }, create: {}, update: {} });

  // --- 7) INVENTORY: seed pickable stock into bins ----------------------------
  const ledger: Prisma.InventoryLedgerCreateManyInput[] = [];
  for (const p of pickables) {
    // spread each product across 1-2 bins
    const nBins = int(1, 2);
    for (let b = 0; b < nBins; b++) {
      ledger.push({ productId: p.id, locationId: pick(bins).id, qtyDelta: int(3, 40), reason: "SEED", condition: "NEW", note: "[SEED] opening stock" });
    }
    // a little show-good + some at each showroom
    if (chance(0.3)) ledger.push({ productId: p.id, locationId: pick(bins).id, qtyDelta: int(1, 4), reason: "SEED", condition: "SHOW_GOOD", note: "[SEED] show good" });
  }
  for (const sr of showrooms) {
    for (const p of pickables.slice(0, 8)) if (chance(0.5)) ledger.push({ productId: p.id, locationId: sr.id, qtyDelta: int(1, 6), reason: "SEED", condition: "NEW", note: "[SEED] showroom floor" });
  }
  await prisma.inventoryLedger.createMany({ data: ledger });

  // --- 8) ORDERS: operational backlog + historical depth ----------------------
  let orderSeq = 10001;
  const custName = () => ({ first: pick(FIRST), last: pick(LAST) });
  const repForShowroom = (srIdx: number) => pgdReps[srIdx % pgdReps.length];

  // operational (schedulable + in-flight) — MANUAL source so deposit gate is bypassed
  const opStatuses = ["DRAFT", "CONFIRMED", "CONFIRMED", "CONFIRMED", "SCHEDULED", "STAGED", "DELIVERED"];
  let opCount = 0;
  for (let i = 0; i < 45; i++) {
    const srIdx = i % showrooms.length;
    const sr = showrooms[srIdx];
    const rep = repForShowroom(srIdx);
    const c = custName();
    const status = pick(opStatuses) as Prisma.OrderCreateInput["status"];
    const base = pick(bases);
    const total = int(600000, 2500000);
    const lineProducts = [base, pick(pickables), pick(pickables)];
    await prisma.order.create({
      data: {
        orderNo: `SO${orderSeq++}`,
        source: "MANUAL",
        status,
        type: "CUSTOMER_DELIVERY",
        division: "PGD",
        customerFirst: c.first,
        customerLast: c.last,
        salesRepName: `${pick(FIRST)} ${pick(LAST)}`,
        salesCenterId: sr.netsuiteSalesCenterId,
        salesRep1Id: rep.num,
        purchasedAt: daysAgo(int(1, 90)),
        totalCents: total,
        subtotalCents: Math.round(total * 0.92),
        salesTaxCents: Math.round(total * 0.07),
        depositReceivedCents: chance(0.7) ? Math.round(total * (0.5 + rnd() * 0.5)) : 0,
        islands: { create: { role: "GRILL", styleCode: base.sku.split("-")[0], attributes: {} } },
        lines: { create: lineProducts.map((p) => ({ productId: p.id, sku: p.sku, qty: 1, origin: "MANUAL" as const })) },
        events: { create: { type: "CREATED", summary: "Demo order created" } },
      },
    });
    opCount++;
  }

  // historical (analytics only) — spread across 2024..now, attributed to showrooms/reps
  const now = Date.now();
  const histRows: Prisma.OrderCreateManyInput[] = [];
  const nHist = 360;
  for (let i = 0; i < nHist; i++) {
    const srIdx = int(0, showrooms.length - 1);
    const sr = showrooms[srIdx];
    const rep = repForShowroom(srIdx);
    const c = custName();
    const total = int(400000, 3000000);
    const div = chance(0.8) ? "PGD" : "PGI";
    histRows.push({
      orderNo: `H${orderSeq++}`,
      source: "LEGACY_IMPORT",
      status: "DELIVERED",
      type: "CUSTOMER_DELIVERY",
      division: div as Prisma.OrderCreateManyInput["division"],
      isHistorical: true,
      customerFirst: c.first,
      customerLast: c.last,
      salesCenterId: sr.netsuiteSalesCenterId,
      salesRep1Id: rep.num,
      purchasedAt: new Date(now - int(30, 900) * 86400000),
      totalCents: total,
      subtotalCents: Math.round(total * 0.92),
    });
  }
  for (const c of chunk(histRows, 60)) await prisma.order.createMany({ data: c });
  // a couple of lines on a sample of historical orders (for top-products)
  const histSample = await prisma.order.findMany({ where: { isHistorical: true }, select: { id: true }, take: 200 });
  const histLines: Prisma.OrderLineCreateManyInput[] = [];
  for (const o of histSample) {
    const p = pick(pickables);
    histLines.push({ orderId: o.id, productId: p.id, sku: p.sku, qty: int(1, 2), origin: "MANUAL" });
  }
  await prisma.orderLine.createMany({ data: histLines });

  // --- 9) SHOWS + promoters + self-reported PGI sales -------------------------
  const promoters = [];
  for (const n of ["Sunshine Expositions", "Coastal Home Shows", "Gulf Events Group", "Atlantic Fairs LLC"]) promoters.push(await prisma.promoter.create({ data: { name: n } }));

  // date windows: 2 active (overlap today), a few upcoming, a few past
  const showPlans: { name: string; short: string; offsetStart: number; len: number; status: string; goal: number }[] = [
    { name: "Orlando Summer Home Expo", short: "Orlando Expo", offsetStart: -2, len: 5, status: "ACTIVE", goal: 15000000 },
    { name: "Tampa Bay Outdoor Living Show", short: "Tampa Show", offsetStart: -1, len: 4, status: "ACTIVE", goal: 12000000 },
    { name: "Naples Luxury Backyard Show", short: "Naples", offsetStart: 10, len: 3, status: "CONFIRMED", goal: 9000000 },
    { name: "Jacksonville Fall Home Show", short: "Jax Fall", offsetStart: 25, len: 3, status: "PLANNED", goal: 8000000 },
    { name: "Charleston Spring Expo", short: "Charleston", offsetStart: -40, len: 4, status: "COMPLETED", goal: 10000000 },
    { name: "Savannah Home & Garden", short: "Savannah", offsetStart: -70, len: 3, status: "COMPLETED", goal: 7000000 },
  ];
  const shows: { id: string; leaderNum: string; status: string; start: number }[] = [];
  for (let i = 0; i < showPlans.length; i++) {
    const sp = showPlans[i];
    const leader = showLeaders[i % showLeaders.length];
    const [city, st] = CITY_ST[i % CITY_ST.length];
    const start = new Date(now + sp.offsetStart * 86400000);
    const end = new Date(now + (sp.offsetStart + sp.len - 1) * 86400000);
    const ev = await prisma.showEvent.create({
      data: {
        name: sp.name,
        shortName: sp.short,
        status: sp.status as Prisma.ShowEventCreateInput["status"],
        city,
        state: st,
        goalCents: sp.goal,
        repsNeeded: int(4, 8),
        leaderEmployeeId: leader.id,
        promoterId: pick(promoters).id,
        dates: { create: { startDate: start, endDate: end } },
      },
    });
    shows.push({ id: ev.id, leaderNum: leader.num, status: sp.status, start: start.getTime() });
  }

  // sales entries: many for active shows (TV board), some for completed (analytics)
  const pgiUser = await prisma.user.findUnique({ where: { email: "pgisales@veranooutdoor.com" }, select: { id: true } });
  const DEAL = ["New Deal", "Upgrade/Add On"];
  const SALE = ["Grill Island", "Island Bar", "Island Combo", "Appliance Only", "Shades of Verano"];
  const ISLANDS = baseStyles;
  const SHADES = ["Abaco", "Monaco", "Nassau"];
  const seDivisionLeader: Record<string, string> = {};
  for (const s of shows) seDivisionLeader[s.id] = s.leaderNum;
  let seCount = 0;
  const seRows: Prisma.SalesEntryCreateManyInput[] = [];
  for (const s of shows) {
    const n = s.status === "ACTIVE" ? int(12, 22) : s.status === "COMPLETED" ? int(8, 16) : 0;
    const leaderEmp = created.find((e) => e.num === s.leaderNum);
    for (let k = 0; k < n; k++) {
      const rep = pick(pgiReps);
      const c = custName();
      const saleType = pick(SALE);
      const isShades = saleType === "Shades of Verano";
      seRows.push({
        division: "PGI",
        salesRepId: rep.id,
        showEventId: s.id,
        showLeaderId: leaderEmp?.id ?? null,
        customerFirst: c.first,
        customerLast: c.last,
        dealType: pick(DEAL),
        saleType,
        priceList: "2026 Retail",
        productTotalCents: int(500000, 2600000),
        pflFeeCents: chance(0.4) ? int(20000, 60000) : null,
        grillIsland: isShades ? null : pick(ISLANDS),
        shadesOfVerano: isShades ? pick(SHADES) : null,
        soldAt: new Date((s.start > now ? now : s.start) + int(0, 3) * 3600000 + k * 60000),
        enteredById: pgiUser?.id ?? null,
      });
      seCount++;
    }
  }
  for (const c of chunk(seRows, 80)) await prisma.salesEntry.createMany({ data: c });

  // Price lists (so the abbreviation lookup + form dropdown work)
  await prisma.priceList.createMany({
    data: [
      { name: "2026 Retail", abbreviation: "RTL", active: true },
      { name: "2026 Show Special", abbreviation: "SHOW", active: true },
      { name: "Contractor", abbreviation: "CON", active: true },
    ],
    skipDuplicates: true,
  });

  // Full operational pipeline in every stage (trips through pick/stage/QC/dispatch,
  // transfers, returns, glass mods, manufacturing, counts).
  const lifecycle = await seedLifecycle();

  return {
    ...lifecycle,
    adminEmail,
    demoEmail,
    locations: 1 + bins.length + 17 + 1 + showrooms.length,
    showrooms: showrooms.length,
    regions: regions.length,
    products: products.length,
    employees: created.length,
    users: users.length,
    permissionGrants: perm.grantsTotal,
    inventoryRows: ledger.length,
    operationalOrders: opCount,
    historicalOrders: nHist,
    shows: shows.length,
    salesEntries: seCount,
  };
}
