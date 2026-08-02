"use server";

import { revalidatePath } from "next/cache";
import { getViewer } from "@/lib/permissions/engine";
import { prisma } from "@/lib/db";
import { requireCan } from "@/lib/rbac";
import {
  fetchSalesCenters,
  fetchOrderSalesCenters,
  fetchNetsuiteOrdersHistorical,
  netsuiteConfig,
} from "@/lib/netsuite";
import { importHistoricalOrders } from "@/lib/netsuite-orders-import";
import { matchSalesCenter } from "@/lib/sales-center";

export interface SalesCenterState {
  ok?: boolean;
  message?: string;
  unmatched?: { id: number; name: string }[];
}

function str(v: FormDataEntryValue | null): string {
  return String(v ?? "").trim();
}

/**
 * Auto-map NetSuite sales centers to showroom Locations by name (reusing the
 * location aliases), setting Location.netsuiteSalesCenterId. Reports the centers
 * it couldn't match (non-showrooms, showrooms not in the WMS, or new name
 * variants) so a human can finish them by hand below.
 */
export async function autoMapSalesCenters(): Promise<SalesCenterState> {
  const user = await getViewer();
  try {
    requireCan(user, "admin.employees:view");
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
  const config = netsuiteConfig();
  if (!config) return { ok: false, message: "NetSuite credentials are not configured." };

  let centers;
  try {
    centers = await fetchSalesCenters(config);
  } catch (e) {
    return { ok: false, message: `NetSuite fetch failed: ${(e as Error).message}` };
  }

  const locs = await prisma.location.findMany({
    where: { type: "WAREHOUSE" },
    select: { id: true, name: true },
  });

  let mapped = 0;
  const unmatched: { id: number; name: string }[] = [];
  for (const c of centers) {
    const locId = matchSalesCenter(c.name, locs);
    if (!locId) {
      unmatched.push(c);
      continue;
    }
    // netsuiteSalesCenterId is unique — free the id from any other location first.
    await prisma.$transaction([
      prisma.location.updateMany({
        where: { netsuiteSalesCenterId: c.id, NOT: { id: locId } },
        data: { netsuiteSalesCenterId: null },
      }),
      prisma.location.update({ where: { id: locId }, data: { netsuiteSalesCenterId: c.id } }),
    ]);
    mapped++;
  }

  revalidatePath("/admin/sales-centers");
  return {
    ok: true,
    message: `Mapped ${mapped} of ${centers.length} sales centers to showrooms. ${unmatched.length} unmatched (see below).`,
    unmatched,
  };
}

export interface HistoricalState {
  ok?: boolean;
  message?: string;
}

/**
 * Backfill a full calendar year of historical (closed/billed) sales orders for
 * analytics — create-only, marked isHistorical (hidden from operational views).
 * `sample` caps it at ~200 orders to validate the pipeline before the full run.
 */
export async function runHistoricalBackfill(
  _prev: HistoricalState,
  formData: FormData
): Promise<HistoricalState> {
  const user = await getViewer();
  try {
    requireCan(user, "admin.employees:view");
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
  const config = netsuiteConfig();
  if (!config) return { ok: false, message: "NetSuite credentials are not configured." };

  const year = Number(str(formData.get("year")));
  if (![2024, 2025, 2026].includes(year)) return { ok: false, message: "Choose 2024, 2025 or 2026." };
  const sample = formData.get("sample") === "on" || formData.get("sample") === "1";

  try {
    const raws = await fetchNetsuiteOrdersHistorical({ year, limit: sample ? 200 : undefined }, config);
    const s = await importHistoricalOrders(raws, config);
    revalidatePath("/admin/sales-centers");
    return {
      ok: true,
      message: `${year}${sample ? " (sample)" : ""}: fetched ${s.fetched}, created ${s.created}, ${s.skippedExisting} already present, ${s.unmatchedLines} unmatched lines.`,
    };
  } catch (e) {
    return { ok: false, message: `Backfill failed: ${(e as Error).message}` };
  }
}

/** Manually set (or clear) a showroom's sales-center id. */
export async function setSalesCenter(formData: FormData): Promise<void> {
  const user = await getViewer();
  requireCan(user, "admin.employees:view");
  const locationId = str(formData.get("locationId"));
  if (!locationId) return;
  const raw = str(formData.get("salesCenterId"));
  const id = /^\d+$/.test(raw) ? Number(raw) : null;

  await prisma.$transaction([
    // Keep it unique: clear this id from any other location.
    ...(id !== null
      ? [
          prisma.location.updateMany({
            where: { netsuiteSalesCenterId: id, NOT: { id: locationId } },
            data: { netsuiteSalesCenterId: null },
          }),
        ]
      : []),
    prisma.location.update({ where: { id: locationId }, data: { netsuiteSalesCenterId: id } }),
  ]);
  revalidatePath("/admin/sales-centers");
}

/**
 * Backfill Order.salesCenterId on existing NetSuite orders (the sync only stores
 * it going forward). Fetches the sales center per transaction id from NetSuite and
 * writes it, in batches.
 */
export async function backfillOrderSalesCenters(): Promise<SalesCenterState> {
  const user = await getViewer();
  try {
    requireCan(user, "admin.employees:view");
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
  const config = netsuiteConfig();
  if (!config) return { ok: false, message: "NetSuite credentials are not configured." };

  const orders = await prisma.order.findMany({
    where: { source: "NETSUITE", netsuiteTransactionId: { not: null }, salesCenterId: null },
    select: { id: true, netsuiteTransactionId: true },
  });
  if (orders.length === 0) return { ok: true, message: "No orders need a sales-center backfill." };

  let scById;
  try {
    scById = await fetchOrderSalesCenters(orders.map((o) => o.netsuiteTransactionId!), config);
  } catch (e) {
    return { ok: false, message: `NetSuite fetch failed: ${(e as Error).message}` };
  }

  const updates = orders
    .map((o) => ({ id: o.id, sc: scById.get(o.netsuiteTransactionId!) }))
    .filter((u): u is { id: string; sc: number } => u.sc !== undefined);

  for (let i = 0; i < updates.length; i += 100) {
    await prisma.$transaction(
      updates.slice(i, i + 100).map((u) =>
        prisma.order.update({ where: { id: u.id }, data: { salesCenterId: u.sc } })
      )
    );
  }

  revalidatePath("/admin/sales-centers");
  return {
    ok: true,
    message: `Backfilled the sales center on ${updates.length} of ${orders.length} orders (${orders.length - updates.length} had none in NetSuite).`,
  };
}
