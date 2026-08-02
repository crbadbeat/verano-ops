import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  fetchNetsuiteItems,
  fetchNetsuiteLocationCosts,
  isCreatableItemType,
  netsuiteConfig,
} from "@/lib/netsuite";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// -----------------------------------------------------------------------------
// Nightly NetSuite sync: NetSuite is the item-master source of truth. Triggered
// by Vercel Cron (see vercel.json), which sends `Authorization: Bearer
// $CRON_SECRET`. Also callable by hand with the same header.
//
// CREATE-OR-UPDATE, keyed on the stable NetSuite number:
//  - UPDATE any product already linked by number — refresh cost, NetSuite name
//    (`name`) and description. It NEVER touches `sku` (identity) or `displayName`
//    (the WMS-owned override the app actually surfaces).
//  - CREATE a product for a NetSuite item that is not one yet, but ONLY for
//    purchased/stocked types (Inventory / Non-inventory — see isCreatableItemType).
//    Assembly/Kit are excluded from creation: that is how configured Bases/Tops
//    appear, and those are born at order intake keyed on their smart-SKU (with a
//    null number until matched in the queue). Auto-creating them here on a numeric
//    SKU would spawn a duplicate that collides when someone links them. They are
//    still UPDATED once linked; they are just never created from a SuiteQL row.
// -----------------------------------------------------------------------------

async function run(req: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { ok: false, error: "CRON_SECRET is not configured on the server." },
      { status: 500 }
    );
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const config = netsuiteConfig();
  if (!config) {
    return NextResponse.json(
      {
        ok: false,
        configured: false,
        message: "NetSuite credentials not set (NETSUITE_*). Nothing synced.",
      },
      { status: 200 }
    );
  }

  let items;
  try {
    items = await fetchNetsuiteItems(config);
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 502 });
  }

  const numbers = items.map((i) => i.netsuiteNumber);
  const existing = numbers.length
    ? await prisma.product.findMany({
        where: { netsuiteNumber: { in: numbers } },
        select: {
          id: true,
          netsuiteNumber: true,
          standardCostCents: true,
          description: true,
          name: true,
        },
      })
    : [];
  const byNumber = new Map(existing.map((p) => [p.netsuiteNumber!, p]));

  const now = new Date();
  const updates: { id: string; data: Record<string, unknown> }[] = [];
  const creates: typeof items = [];
  let costChanged = 0;
  let unmatched = 0;

  for (const it of items) {
    const p = byNumber.get(it.netsuiteNumber);
    if (!p) {
      // Not a product yet. Create purchased/stocked types; leave Assembly/Kit
      // (configured Bases/Tops) to order intake + the match queue.
      if (isCreatableItemType(it.itemType)) creates.push(it);
      else unmatched++;
      continue;
    }
    const data: Record<string, unknown> = {};
    if (it.standardCostCents !== null && it.standardCostCents !== p.standardCostCents) {
      data.standardCostCents = it.standardCostCents;
      costChanged++;
    }
    if (it.description && it.description !== p.description) {
      data.description = it.description;
    }
    // NetSuite's name is the fallback below the WMS `displayName` override; keep
    // it current. `displayName` and `sku` are never touched here.
    if (it.name && it.name !== p.name) {
      data.name = it.name;
    }
    if (Object.keys(data).length === 0) continue; // nothing changed
    data.netsuiteLinkedAt = now;
    updates.push({ id: p.id, data });
  }

  const CHUNK = 100;
  for (let i = 0; i < updates.length; i += CHUNK) {
    await prisma.$transaction(
      updates.slice(i, i + CHUNK).map((u) =>
        prisma.product.update({ where: { id: u.id }, data: u.data })
      )
    );
  }

  // ---- create new purchased items ------------------------------------------
  // sku = the NetSuite number (the purchased-item convention). displayName is
  // left null so the resolver falls back to the NetSuite name until someone
  // curates one. Barcodes are @unique: drop any that collide with an existing
  // product or with each other (first wins) so a dup barcode never causes the
  // whole row to be silently skipped by ON CONFLICT DO NOTHING.
  let created = 0;
  if (creates.length) {
    const barcodes = creates.map((c) => c.barcode).filter((b): b is string => !!b);
    const takenBarcodes = new Set(
      barcodes.length
        ? (
            await prisma.product.findMany({
              where: { barcode: { in: barcodes } },
              select: { barcode: true },
            })
          ).map((r) => r.barcode!)
        : []
    );
    const seenBarcode = new Set<string>();
    const createData = creates.map((c) => {
      let barcode = c.barcode;
      if (barcode && (takenBarcodes.has(barcode) || seenBarcode.has(barcode))) barcode = null;
      if (barcode) seenBarcode.add(barcode);
      return {
        netsuiteNumber: c.netsuiteNumber,
        sku: c.netsuiteNumber,
        name: c.name,
        description: c.description,
        barcode,
        standardCostCents: c.standardCostCents,
        netsuiteLinkedAt: now,
      };
    });
    for (let i = 0; i < createData.length; i += 500) {
      const res = await prisma.product.createMany({
        data: createData.slice(i, i + 500),
        skipDuplicates: true,
      });
      created += res.count;
    }
  }

  // ---- per-location average cost -------------------------------------------
  // Only for warehouses linked to a NetSuite location id. Unlinked WMS warehouses
  // and NetSuite locations with no matching warehouse (showrooms not yet in the
  // WMS) are simply skipped. Cost is written per (product, warehouse); the WMS
  // multiplies its own on-hand by it to value stock per warehouse.
  const warehouses = await prisma.location.findMany({
    where: { type: "WAREHOUSE", netsuiteId: { not: null } },
    select: { id: true, netsuiteId: true },
  });
  const wmsLocByNsId = new Map(warehouses.map((w) => [w.netsuiteId!, w.id]));
  let locationCostsUpserted = 0;
  let locationCostRows = 0;
  if (wmsLocByNsId.size > 0) {
    let locCosts;
    try {
      locCosts = await fetchNetsuiteLocationCosts([...wmsLocByNsId.keys()], config);
    } catch (e) {
      return NextResponse.json(
        { ok: false, error: `location cost sync: ${(e as Error).message}` },
        { status: 502 }
      );
    }
    locationCostRows = locCosts.length;

    const nums = [...new Set(locCosts.map((c) => c.netsuiteNumber))];
    const [prods, existingPLC] = await Promise.all([
      nums.length
        ? prisma.product.findMany({
            where: { netsuiteNumber: { in: nums } },
            select: { id: true, netsuiteNumber: true },
          })
        : [],
      prisma.productLocationCost.findMany({
        where: { locationId: { in: [...wmsLocByNsId.values()] } },
        select: { productId: true, locationId: true, averageCostCents: true },
      }),
    ]);
    const prodByNum = new Map(prods.map((p) => [p.netsuiteNumber!, p.id]));
    const plcKey = (pid: string, lid: string) => `${pid}::${lid}`;
    const existingCost = new Map(existingPLC.map((r) => [plcKey(r.productId, r.locationId), r.averageCostCents]));

    // Only write rows whose cost actually changed — a nightly re-sync where
    // nothing moved should be nearly free rather than re-upserting thousands.
    const upserts: { productId: string; locationId: string; averageCostCents: number }[] = [];
    for (const c of locCosts) {
      if (c.averageCostCents === null) continue;
      const productId = prodByNum.get(c.netsuiteNumber);
      const locationId = wmsLocByNsId.get(c.netsuiteLocationId);
      if (!productId || !locationId) continue;
      if (existingCost.get(plcKey(productId, locationId)) === c.averageCostCents) continue; // unchanged
      upserts.push({ productId, locationId, averageCostCents: c.averageCostCents });
    }

    const LC_CHUNK = 100;
    for (let i = 0; i < upserts.length; i += LC_CHUNK) {
      await prisma.$transaction(
        upserts.slice(i, i + LC_CHUNK).map((u) =>
          prisma.productLocationCost.upsert({
            where: { productId_locationId: { productId: u.productId, locationId: u.locationId } },
            create: { ...u, syncedAt: now },
            update: { averageCostCents: u.averageCostCents, syncedAt: now },
          })
        )
      );
    }
    locationCostsUpserted = upserts.length;
  }

  return NextResponse.json(
    {
      ok: true,
      fetched: items.length,
      matched: items.length - unmatched - created,
      unmatched,
      created,
      updated: updates.length,
      costChanged,
      mappedWarehouses: wmsLocByNsId.size,
      locationCostRows,
      locationCostsUpserted,
      at: now.toISOString(),
    },
    { status: 200 }
  );
}

export async function GET(req: Request): Promise<Response> {
  return run(req);
}

export async function POST(req: Request): Promise<Response> {
  return run(req);
}
