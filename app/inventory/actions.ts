"use server";

import { revalidatePath } from "next/cache";
import { getViewer } from "@/lib/permissions/engine";
import type { BuildCategory, Prisma, StockCondition } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireCan } from "@/lib/rbac";
import { parseSpreadsheet, pickColumn } from "@/lib/spreadsheet";
import { matchKey } from "@/lib/alias";
import { onHandForProduct, onHandForProductAtLocation } from "@/lib/inventory";
import { warehouseLevelLocationId } from "@/lib/locations";
import { normalizeLocationCode } from "@/lib/location-code";
import { computeRebaseline, type SlotQty } from "@/lib/inventory-rebaseline";
import { itemMasterRow, type ItemMasterRow } from "@/lib/item-master";
import {
  CLASSIFICATION_COLUMNS,
  classificationFromRow,
  isChanged,
} from "@/lib/product-import";

export interface UploadState {
  ok?: boolean;
  message?: string;
  created?: number;
  updated?: number;
  skipped?: number;
  errors?: string[];
}

/** Result of an inline form action (mapping edit, alias add, adjust). */
export interface ActionState {
  ok?: boolean;
  message?: string;
}

function parseQty(raw: string): number | null {
  const n = Number(raw.replace(/[, ]/g, ""));
  if (!Number.isFinite(n)) return null;
  return Math.round(n);
}

/**
 * Seed / re-seed on-hand from a spreadsheet.
 * Expected columns (case-insensitive): SKU (NetSuite name), Qty, optional Name/Category.
 * "Sets" on-hand to the uploaded number by writing a delta ledger row.
 */
export async function uploadSeed(
  _prev: UploadState,
  formData: FormData
): Promise<UploadState> {
  const user = await getViewer();
  if (!user) return { ok: false, message: "Not authenticated" };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, message: "Choose a .csv or .xlsx file to upload." };
  }

  let sheet;
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    sheet = await parseSpreadsheet(buffer, file.name);
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }

  const skuCol = pickColumn(sheet.headers, [
    "SKU",
    "NetSuite SKU",
    "NetSuite Name",
    "Item Name",
    "Item",
  ]);
  const qtyCol = pickColumn(sheet.headers, [
    "Qty",
    "Quantity",
    "On Hand",
    "OnHand",
    "Count",
    "Stock",
  ]);
  const nameCol = pickColumn(sheet.headers, ["Name", "Description", "Product Name"]);
  const catCol = pickColumn(sheet.headers, ["Category", "Type"]);

  if (!skuCol || !qtyCol) {
    return {
      ok: false,
      message: `Could not find required columns. Need an SKU column and a Qty column. Found: ${sheet.headers.join(", ")}`,
    };
  }

  let created = 0;
  let updated = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const [i, row] of sheet.rows.entries()) {
    const sku = (row[skuCol] ?? "").trim();
    const qty = parseQty(row[qtyCol] ?? "");
    if (!sku) {
      skipped++;
      continue;
    }
    if (qty === null) {
      errors.push(`Row ${i + 2}: invalid Qty "${row[qtyCol]}" for "${sku}"`);
      skipped++;
      continue;
    }

    try {
      const existing = await prisma.product.findUnique({ where: { sku } });
      const product =
        existing ??
        (await prisma.product.create({
          data: {
            sku,
            name: nameCol && row[nameCol] ? row[nameCol] : sku,
            category: catCol ? row[catCol] || null : null,
          },
        }));

      const current = existing ? await onHandForProduct(product.id) : 0;
      const delta = qty - current;

      if (delta !== 0) {
        await prisma.inventoryLedger.create({
          data: {
            productId: product.id,
            qtyDelta: delta,
            reason: existing ? "ADJUSTMENT" : "SEED",
            note: `Spreadsheet upload "${file.name}" — set on-hand to ${qty}`,
            createdById: user.id,
          },
        });
      }
      if (existing) updated++;
      else created++;
    } catch (e) {
      errors.push(`Row ${i + 2} ("${sku}"): ${(e as Error).message}`);
      skipped++;
    }
  }

  revalidatePath("/inventory");
  return {
    ok: true,
    message: `Done. ${created} created, ${updated} updated, ${skipped} skipped.`,
    created,
    updated,
    skipped,
    errors: errors.slice(0, 20),
  };
}

/**
 * Import the Base / Glass lookup sheets' classification columns onto existing
 * products. ENRICHMENT ONLY — the sheets list every build that is possible, not
 * what exists, so a row with no matching product is reported and skipped rather
 * than created. Accepts either sheet and works out which by its headers.
 */
export async function uploadClassifications(
  _prev: UploadState,
  formData: FormData
): Promise<UploadState> {
  const user = await getViewer();
  try {
    requireCan(user, "inventory:adjust");
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, message: "Choose a .csv or .xlsx file to upload." };
  }

  let sheet;
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    sheet = await parseSpreadsheet(buffer, file.name);
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }

  const cols = {
    sku: pickColumn(sheet.headers, [...CLASSIFICATION_COLUMNS.sku]),
    buildCategory: pickColumn(sheet.headers, [...CLASSIFICATION_COLUMNS.buildCategory]),
    parent: pickColumn(sheet.headers, [...CLASSIFICATION_COLUMNS.parent]),
    maxStock: pickColumn(sheet.headers, [...CLASSIFICATION_COLUMNS.maxStock]),
  };

  if (!cols.sku || (!cols.buildCategory && !cols.parent)) {
    return {
      ok: false,
      message: `Need a SKU/Item column plus a "Base Category" or "Build Item"/"Parent" column. Found: ${sheet.headers.join(", ")}`,
    };
  }

  const resolvedCols = { ...cols, sku: cols.sku };

  const products = await prisma.product.findMany({
    select: {
      id: true,
      sku: true,
      parentSku: true,
      buildCategory: true,
      maxStockLevel: true,
    },
  });
  const bySku = new Map(products.map((p) => [p.sku.trim(), p]));

  const updates: { id: string; data: Record<string, unknown> }[] = [];
  const notes: string[] = [];
  let unchanged = 0;
  let noProduct = 0;
  const parentsSeen = new Set<string>();

  for (const [i, raw] of sheet.rows.entries()) {
    const row = classificationFromRow(raw, resolvedCols);
    if (!row) continue;

    const product = bySku.get(row.sku);
    if (!product) {
      noProduct++;
      continue; // deliberately NOT created
    }
    for (const n of row.notes) notes.push(`Row ${i + 2} ("${row.sku}"): ${n}`);
    if (row.parentSku && row.parentSku !== row.sku) parentsSeen.add(row.parentSku);

    if (!isChanged(row, product)) {
      unchanged++;
      continue;
    }
    // A sheet that lacks a column must not wipe what another sheet set.
    const data: Record<string, unknown> = {};
    if (row.buildCategory !== null) data.buildCategory = row.buildCategory;
    if (row.parentSku !== null) data.parentSku = row.parentSku;
    if (row.maxStockLevel !== null) data.maxStockLevel = row.maxStockLevel;
    updates.push({ id: product.id, data });
  }

  // Chunked so a large sheet doesn't open one enormous transaction.
  const CHUNK = 100;
  for (let i = 0; i < updates.length; i += CHUNK) {
    await prisma.$transaction(
      updates
        .slice(i, i + CHUNK)
        .map((u) => prisma.product.update({ where: { id: u.id }, data: u.data }))
    );
  }

  const dangling = [...parentsSeen].filter((p) => !bySku.has(p));
  if (dangling.length) {
    notes.push(
      `${dangling.length} parent SKU(s) are not products here, so those links point nowhere yet: ${dangling
        .slice(0, 10)
        .join(", ")}${dangling.length > 10 ? "…" : ""}`
    );
  }

  revalidatePath("/inventory");
  revalidatePath("/inventory/sku-review");
  return {
    ok: true,
    message: `Done. ${updates.length} classified, ${unchanged} already current, ${noProduct} sheet row(s) had no product and were not created.`,
    updated: updates.length,
    skipped: noProduct,
    errors: notes.slice(0, 25),
  };
}

/**
 * Import manufacturer barcodes onto existing products for scan-picking.
 * Expected columns (case-insensitive): SKU (NetSuite name), Barcode.
 * ENRICHMENT ONLY — a row with no matching product is reported, never created.
 * Bases/Glass scan a QR of the SKU itself, so this is for the other items.
 */
export async function uploadBarcodes(
  _prev: UploadState,
  formData: FormData
): Promise<UploadState> {
  const user = await getViewer();
  try {
    requireCan(user, "inventory:adjust");
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, message: "Choose a .csv or .xlsx file to upload." };
  }

  let sheet;
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    sheet = await parseSpreadsheet(buffer, file.name);
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }

  const skuCol = pickColumn(sheet.headers, ["SKU", "NetSuite SKU", "NetSuite Name", "Item", "Item Name"]);
  const barcodeCol = pickColumn(sheet.headers, ["Barcode", "UPC", "Bar Code", "EAN", "GTIN"]);
  if (!skuCol || !barcodeCol) {
    return {
      ok: false,
      message: `Need an SKU column and a Barcode column. Found: ${sheet.headers.join(", ")}`,
    };
  }

  // Collapse to sku -> barcode (last non-blank wins).
  const wanted = new Map<string, string>();
  let skipped = 0;
  for (const row of sheet.rows) {
    const sku = (row[skuCol] ?? "").trim();
    const barcode = (row[barcodeCol] ?? "").trim();
    if (!sku || !barcode) {
      skipped++;
      continue;
    }
    wanted.set(sku, barcode);
  }

  const [products, owners] = await Promise.all([
    prisma.product.findMany({
      where: { sku: { in: [...wanted.keys()] } },
      select: { id: true, sku: true, barcode: true },
    }),
    prisma.product.findMany({
      where: { barcode: { in: [...new Set(wanted.values())] } },
      select: { id: true, sku: true, barcode: true },
    }),
  ]);
  const bySku = new Map(products.map((p) => [p.sku, p]));
  const ownerByBarcode = new Map(owners.map((o) => [o.barcode as string, o]));

  const updates: { id: string; barcode: string }[] = [];
  const errors: string[] = [];
  const usedInRun = new Set<string>();
  let unchanged = 0;
  let noProduct = 0;

  for (const [sku, barcode] of wanted) {
    const product = bySku.get(sku);
    if (!product) {
      noProduct++;
      continue; // enrichment only — never created
    }
    if (product.barcode === barcode) {
      unchanged++;
      continue;
    }
    // A barcode belongs to exactly one product (unique). Reject a clash rather
    // than let the update throw halfway through the batch.
    const owner = ownerByBarcode.get(barcode);
    if ((owner && owner.id !== product.id) || usedInRun.has(barcode)) {
      errors.push(`Barcode ${barcode} is already taken — left ${sku} unchanged.`);
      continue;
    }
    usedInRun.add(barcode);
    updates.push({ id: product.id, barcode });
  }

  const CHUNK = 100;
  for (let i = 0; i < updates.length; i += CHUNK) {
    await prisma.$transaction(
      updates
        .slice(i, i + CHUNK)
        .map((u) => prisma.product.update({ where: { id: u.id }, data: { barcode: u.barcode } }))
    );
  }

  revalidatePath("/inventory");
  return {
    ok: true,
    message: `Done. ${updates.length} barcodes set, ${unchanged} already current, ${noProduct} had no product, ${skipped} blank.`,
    updated: updates.length,
    skipped: noProduct + skipped,
    errors: errors.slice(0, 25),
  };
}

/**
 * FULL-REPLACE inventory upload, by location. On-hand is set to exactly the
 * uploaded slots and every current slot NOT in the file is zeroed — a re-baseline
 * from a physical count. Written as auditable ADJUSTMENT ledger deltas (history
 * kept, nothing deleted). Unknown SKUs are auto-created; unknown locations are
 * reported and skipped. Columns: SKU, Location (bin code; blank = warehouse
 * level), Quantity, optional Condition (NEW/SHOW_GOOD). MANAGER/ADMIN only.
 */
export async function uploadInventoryByLocation(
  _prev: UploadState,
  formData: FormData
): Promise<UploadState> {
  const user = await getViewer();
  try {
    requireCan(user, "inventory:adjust");
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, message: "Choose a .csv or .xlsx file to upload." };
  }

  let sheet;
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    sheet = await parseSpreadsheet(buffer, file.name);
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }

  const skuCol = pickColumn(sheet.headers, ["SKU", "NetSuite SKU", "NetSuite Name", "Item", "Item Name"]);
  const locCol = pickColumn(sheet.headers, ["Location", "Bin", "Location Code", "Bin Code"]);
  const qtyCol = pickColumn(sheet.headers, ["Quantity", "Qty", "On Hand", "OnHand", "Count"]);
  const condCol = pickColumn(sheet.headers, ["Condition", "Stock Condition", "State"]);
  if (!skuCol || !qtyCol) {
    return {
      ok: false,
      message: `Need a SKU column and a Quantity column. Found: ${sheet.headers.join(", ")}`,
    };
  }

  const errors: string[] = [];
  let skipped = 0;
  const parsed: { sku: string; locCode: string; qty: number; condition: "NEW" | "SHOW_GOOD" }[] = [];
  for (const [i, row] of sheet.rows.entries()) {
    const sku = (row[skuCol] ?? "").trim();
    const qtyRaw = (row[qtyCol] ?? "").trim();
    if (!sku) {
      skipped++;
      continue;
    }
    const qty = Number(qtyRaw.replace(/[, ]/g, ""));
    if (!Number.isInteger(qty) || qty < 0) {
      errors.push(`Row ${i + 2}: invalid quantity "${qtyRaw}" for ${sku}`);
      skipped++;
      continue;
    }
    const condRaw = (condCol ? row[condCol] ?? "" : "").trim().toUpperCase().replace(/[\s_-]/g, "");
    const condition = condRaw === "SHOWGOOD" ? "SHOW_GOOD" : "NEW";
    const locCode = locCol ? (row[locCol] ?? "").trim() : "";
    parsed.push({ sku, locCode, qty, condition });
  }
  if (parsed.length === 0) return { ok: false, message: "No usable rows found." };

  // Resolve each SKU-column value against sku, then the NetSuite number, then a
  // barcode; auto-create the truly unknown ones (unlinked to NetSuite).
  const ids = [...new Set(parsed.map((p) => p.sku))];
  const lookup = () =>
    prisma.product.findMany({
      where: { OR: [{ sku: { in: ids } }, { netsuiteNumber: { in: ids } }, { barcode: { in: ids } }] },
      select: { id: true, sku: true, netsuiteNumber: true, barcode: true },
    });
  let products = await lookup();
  const resolver = () => {
    const bySku = new Map(products.map((p) => [p.sku, p]));
    const byNumber = new Map(products.filter((p) => p.netsuiteNumber).map((p) => [p.netsuiteNumber!, p]));
    const byBarcode = new Map(products.filter((p) => p.barcode).map((p) => [p.barcode!, p]));
    return (id: string) => bySku.get(id) ?? byNumber.get(id) ?? byBarcode.get(id) ?? null;
  };
  let resolve = resolver();
  const missing = ids.filter((id) => !resolve(id));
  let created = 0;
  if (missing.length) {
    await prisma.product.createMany({ data: missing.map((sku) => ({ sku, name: sku })), skipDuplicates: true });
    created = missing.length;
    products = await lookup();
    resolve = resolver();
  }

  // Resolve locations; blank = warehouse level (null), unknown code is skipped.
  const codes = [...new Set(parsed.map((p) => p.locCode).filter(Boolean).map(normalizeLocationCode))];
  const locs = codes.length
    ? await prisma.location.findMany({ where: { code: { in: codes } }, select: { id: true, code: true } })
    : [];
  const locByCode = new Map(locs.map((l) => [l.code, l]));

  const target: SlotQty[] = [];
  const unknownLoc = new Set<string>();
  for (const p of parsed) {
    const product = resolve(p.sku);
    if (!product) {
      skipped++;
      continue;
    }
    let locationId: string | null = null;
    if (p.locCode) {
      const loc = locByCode.get(normalizeLocationCode(p.locCode));
      if (!loc) {
        unknownLoc.add(p.locCode);
        skipped++;
        continue;
      }
      locationId = loc.id;
    }
    target.push({ productId: product.id, locationId, condition: p.condition, qty: p.qty });
  }
  if (unknownLoc.size) {
    errors.push(
      `${unknownLoc.size} location(s) not found and skipped: ${[...unknownLoc].slice(0, 10).join(", ")}${unknownLoc.size > 10 ? "…" : ""}`
    );
  }

  // Current nonzero slots (all of them — this is a full replace).
  const currentRaw = await prisma.inventoryLedger.groupBy({
    by: ["productId", "locationId", "condition"],
    _sum: { qtyDelta: true },
  });
  const current: SlotQty[] = currentRaw
    .map((r) => ({ productId: r.productId, locationId: r.locationId, condition: r.condition, qty: r._sum.qtyDelta ?? 0 }))
    .filter((s) => s.qty !== 0);

  const deltas = computeRebaseline(target, current);

  const skuById = new Map(products.map((p) => [p.id, p.sku]));
  const codeById = new Map(locs.map((l) => [l.id, l.code]));
  const where = (locationId: string | null) =>
    locationId ? `@ ${codeById.get(locationId) ?? locationId}` : "(warehouse level)";
  const rows = deltas.map((d) => ({
    productId: d.productId,
    locationId: d.locationId,
    condition: d.condition,
    qtyDelta: d.delta,
    reason: "ADJUSTMENT" as const,
    note:
      d.targetQty === null
        ? `By-location upload — cleared ${skuById.get(d.productId) ?? ""} ${where(d.locationId)}`
        : `By-location upload — set ${skuById.get(d.productId) ?? ""} ${where(d.locationId)} to ${d.targetQty}`,
    createdById: user!.id,
  }));

  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    await prisma.inventoryLedger.createMany({ data: rows.slice(i, i + CHUNK) });
  }

  revalidatePath("/inventory");

  const set = deltas.filter((d) => d.targetQty !== null).length;
  const cleared = deltas.filter((d) => d.targetQty === null).length;
  return {
    ok: true,
    message: `Done. ${set} slot(s) set, ${cleared} cleared to zero, ${created} new product(s) created, ${skipped} row(s) skipped.`,
    created,
    skipped,
    errors: errors.slice(0, 25),
  };
}

/**
 * Import / reload the Item Master, keyed on the stable NetSuite NUMBER. The
 * NetSuite name becomes the (mutable) description; sku stays the working key
 * (the number for purchased items, a smart-SKU for grammar items via the SKU
 * column). Upsert by number — created/updated products count as NetSuite-linked.
 * Columns (case-insensitive): NetSuite Number, Description, Display Name, Barcode,
 * Category, optional SKU. MANAGER/ADMIN only.
 */
export async function uploadItemMaster(
  _prev: UploadState,
  formData: FormData
): Promise<UploadState> {
  const user = await getViewer();
  try {
    requireCan(user, "inventory:adjust");
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, message: "Choose a .csv or .xlsx file to upload." };
  }

  let sheet;
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    sheet = await parseSpreadsheet(buffer, file.name);
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }

  const numberCol = pickColumn(sheet.headers, [
    "NetSuite Number", "NetSuite Item Number", "Item Number", "Internal ID", "NetSuite ID", "Number",
  ]);
  const descCol = pickColumn(sheet.headers, [
    "Description", "NetSuite Name", "Item Name", "Sales Description", "Purchase Description",
  ]);
  const displayCol = pickColumn(sheet.headers, ["Display Name", "Display"]);
  const barcodeCol = pickColumn(sheet.headers, ["Barcode", "UPC", "GTIN", "Bar Code"]);
  const catCol = pickColumn(sheet.headers, ["Category", "Type"]);
  const skuCol = pickColumn(sheet.headers, ["SKU", "Smart SKU", "Item SKU"]);
  if (!numberCol) {
    return {
      ok: false,
      message: `Need a NetSuite Number column. Found: ${sheet.headers.join(", ")}`,
    };
  }

  // Map + dedupe by number (last wins).
  const byNumber = new Map<string, ItemMasterRow>();
  let skipped = 0;
  for (const row of sheet.rows) {
    const r = itemMasterRow({
      number: row[numberCol],
      sku: skuCol ? row[skuCol] : undefined,
      displayName: displayCol ? row[displayCol] : undefined,
      description: descCol ? row[descCol] : undefined,
      barcode: barcodeCol ? row[barcodeCol] : undefined,
      category: catCol ? row[catCol] : undefined,
    });
    if (!r) {
      skipped++;
      continue;
    }
    byNumber.set(r.netsuiteNumber, r);
  }
  if (byNumber.size === 0) return { ok: false, message: "No rows with a NetSuite number." };

  // Enforce sku / barcode uniqueness within the file (they are unique columns).
  const errors: string[] = [];
  const seenSku = new Map<string, string>();
  const seenBarcode = new Map<string, string>();
  const rows: ItemMasterRow[] = [];
  for (const r of byNumber.values()) {
    const skuOwner = seenSku.get(r.sku);
    if (skuOwner && skuOwner !== r.netsuiteNumber) {
      errors.push(`SKU ${r.sku} appears on two items (${skuOwner}, ${r.netsuiteNumber}) — second skipped.`);
      continue;
    }
    let barcode = r.barcode;
    if (barcode && seenBarcode.has(barcode)) {
      errors.push(`Barcode ${barcode} appears on two items — cleared on ${r.netsuiteNumber}.`);
      barcode = null;
    }
    seenSku.set(r.sku, r.netsuiteNumber);
    if (barcode) seenBarcode.set(barcode, r.netsuiteNumber);
    rows.push({ ...r, barcode });
  }

  // Resolve existing products by number OR by sku, so re-uploading links an
  // already app-created Base/Glass (keyed on its smart-SKU) to a NetSuite number
  // added later — instead of creating a duplicate.
  const existing = await prisma.product.findMany({
    where: {
      OR: [
        { netsuiteNumber: { in: rows.map((r) => r.netsuiteNumber) } },
        { sku: { in: rows.map((r) => r.sku) } },
      ],
    },
    select: { id: true, netsuiteNumber: true, sku: true },
  });
  const byNum = new Map(existing.filter((p) => p.netsuiteNumber).map((p) => [p.netsuiteNumber!, p]));
  const bySkuExisting = new Map(existing.map((p) => [p.sku, p]));
  const toCreate: ItemMasterRow[] = [];
  const toUpdate: { id: string; row: ItemMasterRow }[] = [];
  for (const r of rows) {
    const match = byNum.get(r.netsuiteNumber) ?? bySkuExisting.get(r.sku);
    if (match) toUpdate.push({ id: match.id, row: r });
    else toCreate.push(r);
  }

  try {
    const CHUNK = 500;
    for (let i = 0; i < toCreate.length; i += CHUNK) {
      await prisma.product.createMany({
        data: toCreate.slice(i, i + CHUNK).map((r) => ({
          netsuiteNumber: r.netsuiteNumber,
          sku: r.sku,
          name: r.name,
          description: r.description,
          barcode: r.barcode,
          category: r.category,
          netsuiteLinkedAt: new Date(),
        })),
        skipDuplicates: true,
      });
    }
    for (let i = 0; i < toUpdate.length; i += 100) {
      await prisma.$transaction(
        toUpdate.slice(i, i + 100).map(({ id, row: r }) =>
          prisma.product.update({
            where: { id },
            data: {
              netsuiteNumber: r.netsuiteNumber,
              sku: r.sku,
              name: r.name,
              description: r.description,
              barcode: r.barcode,
              category: r.category,
              netsuiteLinkedAt: new Date(),
            },
          })
        )
      );
    }
  } catch (e) {
    return {
      ok: false,
      message: `Import failed: ${(e as Error).message}. Check for a SKU or barcode that clashes with an existing product.`,
    };
  }

  revalidatePath("/inventory");
  return {
    ok: true,
    message: `Done. ${toCreate.length} created, ${toUpdate.length} updated/linked, ${skipped} row(s) without a number skipped.`,
    created: toCreate.length,
    updated: toUpdate.length,
    skipped,
    errors: errors.slice(0, 25),
  };
}

// On-hand corrections now flow through `adjustStockWithReason` (reason required,
// warehouse + condition aware) and pickability through `updateProductMapping`
// below, both from the item-detail page. The old reason-optional quick-adjust and
// the standalone pickable toggle were removed with the /inventory rebuild.

// ---- item detail: view / edit mapping --------------------------------------

const BUILD_CATEGORIES: BuildCategory[] = ["SPECIAL", "PARENT", "CHILD"];

/** Trim to a value or null (nullable text fields store null, not ""). */
function nullable(v: FormDataEntryValue | null): string | null {
  const s = String(v ?? "").trim();
  return s === "" ? null : s;
}

/**
 * Edit a product's mapping/identity fields from the item-detail page. The SKU is
 * deliberately NOT editable — it is the product's identity and its whole ledger
 * history hangs off it. The stable NetSuite NUMBER is the safe anchor to edit;
 * setting one links the product to NetSuite (clears it from the match queue).
 * MANAGER/ADMIN only.
 */
export async function updateProductMapping(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await getViewer();
  try {
    requireCan(user, "catalog:edit");
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }

  const productId = String(formData.get("productId") ?? "");
  const existing = await prisma.product.findUnique({ where: { id: productId } });
  if (!existing) return { ok: false, message: "Product not found." };

  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { ok: false, message: "A display name is required." };

  const buildRaw = nullable(formData.get("buildCategory"));
  if (buildRaw && !BUILD_CATEGORIES.includes(buildRaw as BuildCategory)) {
    return { ok: false, message: `Invalid build category "${buildRaw}".` };
  }

  const maxRaw = nullable(formData.get("maxStockLevel"));
  let maxStockLevel: number | null = null;
  if (maxRaw !== null) {
    const n = Number(maxRaw);
    if (!Number.isInteger(n) || n < 0) {
      return { ok: false, message: `Max stock level must be a whole number ≥ 0.` };
    }
    maxStockLevel = n;
  }

  const netsuiteNumber = nullable(formData.get("netsuiteNumber"));

  const data: Prisma.ProductUpdateInput = {
    displayName: nullable(formData.get("displayName")),
    name,
    description: nullable(formData.get("description")),
    category: nullable(formData.get("category")),
    barcode: nullable(formData.get("barcode")),
    parentSku: nullable(formData.get("parentSku")),
    buildCategory: (buildRaw as BuildCategory | null),
    maxStockLevel,
    pickable: formData.get("pickable") === "on" || formData.get("pickable") === "1",
    active: formData.get("active") === "on" || formData.get("active") === "1",
    netsuiteNumber,
  };
  // Setting a NetSuite number is a link event; keep the existing link date if it
  // already had one, stamp a fresh one otherwise. Clearing it leaves the history.
  if (netsuiteNumber) {
    data.netsuiteLinkedAt = existing.netsuiteLinkedAt ?? new Date();
  }

  try {
    await prisma.product.update({ where: { id: productId }, data });
  } catch (e) {
    const err = e as { code?: string; meta?: { target?: string[] } };
    if (err.code === "P2002") {
      const field = err.meta?.target?.join(", ") ?? "a unique field";
      return {
        ok: false,
        message: `That ${field.includes("barcode") ? "barcode" : "NetSuite number"} already belongs to another product.`,
      };
    }
    return { ok: false, message: (e as Error).message };
  }

  revalidatePath(`/inventory/${productId}`);
  revalidatePath("/inventory");
  return { ok: true, message: "Saved." };
}

// ---- item detail: pick-alias editor ----------------------------------------

/**
 * Add / correct a scan alias for a product, so a scanned line resolves to it.
 * Keyed on the normalized alias detail (falling back to the alias text).
 * MANAGER/ADMIN only.
 */
export async function addPickAlias(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await getViewer();
  try {
    requireCan(user, "catalog:edit");
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }

  const productId = String(formData.get("productId") ?? "");
  const sourceItem = String(formData.get("sourceItem") ?? "").trim();
  const sourceDetail = nullable(formData.get("sourceDetail"));
  const category = nullable(formData.get("category"));
  if (!sourceItem) return { ok: false, message: "Enter the scan alias." };

  const product = await prisma.product.findUnique({ where: { id: productId }, select: { id: true } });
  if (!product) return { ok: false, message: "Product not found." };

  const key = matchKey(sourceDetail ?? sourceItem);
  await prisma.pickAlias.upsert({
    where: { matchKey: key },
    create: { productId, sourceItem, sourceDetail, category, matchKey: key },
    update: { productId, sourceItem, sourceDetail, category },
  });

  revalidatePath(`/inventory/${productId}`);
  return { ok: true, message: `Alias “${sourceDetail ?? sourceItem}” saved.` };
}

/** Remove a scan alias. MANAGER/ADMIN only. */
export async function deletePickAlias(formData: FormData): Promise<void> {
  const user = await getViewer();
  requireCan(user, "catalog:edit");

  const id = String(formData.get("aliasId") ?? "");
  const productId = String(formData.get("productId") ?? "");
  if (!id) return;
  await prisma.pickAlias.delete({ where: { id } });
  revalidatePath(`/inventory/${productId}`);
}

// ---- item detail: reason-required adjust -----------------------------------

/**
 * Correct on-hand at a chosen warehouse + condition, WITH a mandatory reason.
 * Writes an auditable ADJUSTMENT ledger row (the reason lands in the note, which
 * the movement history renders). The warehouse resolves to the right slot:
 * null for the default warehouse, its own id everywhere else. MANAGER/ADMIN only.
 */
export async function adjustStockWithReason(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await getViewer();
  try {
    requireCan(user, "inventory:adjust");
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }

  const productId = String(formData.get("productId") ?? "");
  const mode = String(formData.get("mode") ?? "delta"); // "delta" | "set"
  const amount = Number(formData.get("amount") ?? 0);
  const reason = String(formData.get("reason") ?? "").trim();
  const warehouseId = nullable(formData.get("warehouseId"));
  const condRaw = String(formData.get("condition") ?? "NEW").toUpperCase();
  const condition: StockCondition = condRaw === "SHOW_GOOD" ? "SHOW_GOOD" : "NEW";

  if (!productId) return { ok: false, message: "Missing product." };
  if (!reason) return { ok: false, message: "A reason is required for every adjustment." };
  if (!Number.isFinite(amount)) return { ok: false, message: "Enter a number." };

  const product = await prisma.product.findUnique({ where: { id: productId }, select: { id: true } });
  if (!product) return { ok: false, message: "Product not found." };

  // Resolve the slot's locationId: warehouse level for the chosen warehouse.
  let locationId: string | null = null;
  if (warehouseId) {
    const wh = await prisma.location.findUnique({
      where: { id: warehouseId },
      select: { id: true, type: true, isDefaultWarehouse: true },
    });
    if (!wh || wh.type !== "WAREHOUSE") {
      return { ok: false, message: "Choose a valid warehouse." };
    }
    locationId = warehouseLevelLocationId(wh);
  }

  // "set" turns the target on-hand into a delta against the current slot balance.
  let delta = Math.round(amount);
  if (mode === "set") {
    const current = await onHandForProductAtLocation(productId, locationId, condition);
    delta = Math.round(amount) - current;
  }
  if (delta === 0) return { ok: false, message: "No change — that is already the on-hand." };

  await prisma.inventoryLedger.create({
    data: {
      productId,
      locationId,
      condition,
      qtyDelta: delta,
      reason: "ADJUSTMENT",
      note: reason,
      createdById: user!.id,
    },
  });

  revalidatePath(`/inventory/${productId}`);
  revalidatePath("/inventory");
  return {
    ok: true,
    message: `Adjusted ${delta > 0 ? "+" : ""}${delta}${condition === "SHOW_GOOD" ? " show good" : ""}.`,
  };
}
