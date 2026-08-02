"use server";

import { revalidatePath } from "next/cache";
import { requireCan } from "@/lib/rbac";
import { getViewer } from "@/lib/permissions/engine";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { aggregateCounts } from "@/lib/count";
import { onHandByProductLocation, productLocationKey } from "@/lib/inventory";

// ---- session lifecycle ------------------------------------------------------

const createSchema = z.object({
  warehouseId: z.string().min(1),
  label: z.string().optional(),
  type: z.enum(["FULL", "CYCLE"]).optional(),
});

/** Open a new monthly count for a warehouse. MANAGER/ADMIN only. */
export async function createSession(formData: FormData): Promise<void> {
  const user = await getViewer();
  requireCan(user, "count:post");

  const parsed = createSchema.safeParse({
    warehouseId: formData.get("warehouseId"),
    label: formData.get("label"),
    type: formData.get("type") || undefined,
  });
  if (!parsed.success) throw new Error("Choose a warehouse to count.");

  const warehouse = await prisma.location.findUnique({
    where: { id: parsed.data.warehouseId },
  });
  if (!warehouse || warehouse.type !== "WAREHOUSE") {
    throw new Error("That warehouse does not exist.");
  }

  const type = parsed.data.type ?? "FULL";
  const label =
    parsed.data.label?.trim() ||
    `${warehouse.code} ${type === "CYCLE" ? "cycle" : "full"} — ${new Date()
      .toISOString()
      .slice(0, 10)}`;

  const session = await prisma.countSession.create({
    data: {
      label,
      warehouseId: warehouse.id,
      status: "OPEN",
      type,
      createdById: user!.id,
    },
  });

  redirect(`/count/${session.id}`);
}

/** Cancel a count session (only while it hasn't been posted). MANAGER/ADMIN. */
export async function cancelSession(formData: FormData): Promise<void> {
  const user = await getViewer();
  requireCan(user, "count:post");

  const id = String(formData.get("sessionId") ?? "");
  const session = await prisma.countSession.findUnique({ where: { id } });
  if (!session) throw new Error("Session not found.");
  if (session.status === "POSTED") throw new Error("A posted count cannot be cancelled.");

  await prisma.countSession.update({ where: { id }, data: { status: "CANCELLED" } });
  revalidatePath("/count");
  revalidatePath(`/count/${id}`);
}

// ---- product lookup (for the count picker) ---------------------------------

export interface ProductLite {
  id: string;
  sku: string;
  name: string;
  category: string | null;
  crateSize: number | null;
}

function categoryClause(category?: string) {
  if (category === "BASE")
    return { category: { contains: "base", mode: "insensitive" as const } };
  if (category === "GLASS")
    return { category: { contains: "glass", mode: "insensitive" as const } };
  if (category === "APPLIANCE")
    return {
      OR: [
        { category: { contains: "appl", mode: "insensitive" as const } },
        { category: { contains: "raw", mode: "insensitive" as const } },
        { category: { contains: "extra", mode: "insensitive" as const } },
      ],
    };
  return {};
}

/** Type-ahead product search for the count entry picker. */
export async function searchProducts(
  query: string,
  category?: string
): Promise<ProductLite[]> {
  const user = await getViewer();
  if (!user) return [];

  const q = query.trim();
  const products = await prisma.product.findMany({
    where: {
      active: true,
      AND: [
        q
          ? {
              OR: [
                { sku: { contains: q, mode: "insensitive" } },
                { name: { contains: q, mode: "insensitive" } },
              ],
            }
          : {},
        categoryClause(category),
      ],
    },
    orderBy: { sku: "asc" },
    take: 20,
    select: { id: true, sku: true, name: true, category: true, crateSize: true },
  });
  return products;
}

// ---- count entries ----------------------------------------------------------

export interface EntryState {
  ok?: boolean;
  message?: string;
}

const entrySchema = z.object({
  sessionId: z.string().min(1),
  locationId: z.string().optional(),
  productId: z.string().optional(),
  sku: z.string().optional(),
  qty: z.coerce.number().int().optional(),
  crateCount: z.coerce.number().int().optional(),
  method: z.enum(["SCAN", "MANUAL", "CONFIG", "CRATE"]).optional(),
  condition: z.enum(["NEW", "SHOW_GOOD"]).optional(),
});

/**
 * Record one blind-count observation. Resolves the product by explicit id or by
 * exact SKU; an unresolved SKU is stored as `rawSku` (mapped by a manager at
 * review). Crate entries expand to qty = crateCount * product.crateSize.
 */
export async function addCountEntry(
  _prev: EntryState,
  formData: FormData
): Promise<EntryState> {
  const user = await getViewer();
  if (!user) return { ok: false, message: "Not authenticated" };

  const parsed = entrySchema.safeParse({
    sessionId: formData.get("sessionId"),
    locationId: formData.get("locationId"),
    productId: formData.get("productId"),
    sku: formData.get("sku"),
    qty: formData.get("qty"),
    crateCount: formData.get("crateCount"),
    method: formData.get("method"),
    condition: formData.get("condition"),
  });
  if (!parsed.success) return { ok: false, message: "Invalid entry." };
  const d = parsed.data;

  const session = await prisma.countSession.findUnique({
    where: { id: d.sessionId },
  });
  if (!session) return { ok: false, message: "Session not found." };
  if (session.status !== "OPEN") {
    return { ok: false, message: "This count is no longer open for entries." };
  }

  // Resolve product: explicit id wins, else exact SKU match, else unmatched.
  const rawSku = (d.sku ?? "").trim();
  let productId: string | null = d.productId?.trim() || null;
  let product = productId
    ? await prisma.product.findUnique({ where: { id: productId } })
    : null;
  if (!product && rawSku) {
    product = await prisma.product.findUnique({ where: { sku: rawSku } });
    productId = product?.id ?? null;
  }
  if (!productId && !rawSku) {
    return { ok: false, message: "Scan or pick an item first." };
  }

  const locationId = d.locationId?.trim() || null; // null = warehouse level (bases)

  // Quantity: crate entries expand via crateSize; otherwise use the typed qty.
  let qty = d.qty ?? 0;
  let method = d.method ?? "MANUAL";
  const crateCount = d.crateCount ?? null;
  if (crateCount && crateCount > 0) {
    if (!product?.crateSize || product.crateSize <= 0) {
      return {
        ok: false,
        message: `Set a crate size for ${product?.sku ?? rawSku} before counting crates.`,
      };
    }
    qty = crateCount * product.crateSize;
    method = "CRATE";
  }
  if (!Number.isFinite(qty) || qty <= 0) {
    return { ok: false, message: "Enter a quantity of 1 or more." };
  }

  const condition = d.condition ?? "NEW";

  await prisma.countEntry.create({
    data: {
      sessionId: d.sessionId,
      locationId,
      productId,
      rawSku: productId ? null : rawSku, // keep the raw value only when unmatched
      qty,
      condition,
      crateCount,
      method,
      countedById: user.id,
    },
  });

  revalidatePath(`/count/${d.sessionId}`);
  return {
    ok: true,
    message: `Counted ${qty} × ${product?.sku ?? rawSku}${
      condition === "SHOW_GOOD" ? " (show good)" : ""
    }`,
  };
}

/** Remove an entry (correcting a mistake) while the session is still open. */
export async function deleteCountEntry(formData: FormData): Promise<void> {
  const user = await getViewer();
  if (!user) throw new Error("Not authenticated");

  const id = String(formData.get("entryId") ?? "");
  const entry = await prisma.countEntry.findUnique({
    where: { id },
    include: { session: true },
  });
  if (!entry) return;
  if (entry.session.status !== "OPEN") {
    throw new Error("This count is no longer open for edits.");
  }

  await prisma.countEntry.delete({ where: { id } });
  revalidatePath(`/count/${entry.sessionId}`);
}

// ---- review + post ----------------------------------------------------------

/** Freeze counting so a manager can review variances (OPEN -> REVIEW). */
export async function startReview(formData: FormData): Promise<void> {
  const user = await getViewer();
  requireCan(user, "count:post");
  const id = String(formData.get("sessionId") ?? "");
  const s = await prisma.countSession.findUnique({ where: { id } });
  if (!s) throw new Error("Session not found.");
  if (s.status !== "OPEN") throw new Error("Only an open count can be frozen for review.");
  await prisma.countSession.update({ where: { id }, data: { status: "REVIEW" } });
  revalidatePath(`/count/${id}`);
  revalidatePath(`/count/${id}/review`);
  revalidatePath("/count");
}

/** Resume counting (REVIEW -> OPEN). */
export async function reopenSession(formData: FormData): Promise<void> {
  const user = await getViewer();
  requireCan(user, "count:post");
  const id = String(formData.get("sessionId") ?? "");
  const s = await prisma.countSession.findUnique({ where: { id } });
  if (!s) throw new Error("Session not found.");
  if (s.status !== "REVIEW") throw new Error("Only a count in review can be reopened.");
  await prisma.countSession.update({ where: { id }, data: { status: "OPEN" } });
  revalidatePath(`/count/${id}`);
  revalidatePath(`/count/${id}/review`);
  revalidatePath("/count");
}

/** Attach an unmatched entry to a real product by SKU. MANAGER/ADMIN. */
export async function mapCountEntry(formData: FormData): Promise<void> {
  const user = await getViewer();
  requireCan(user, "count:post");
  const entryId = String(formData.get("entryId") ?? "");
  const sku = String(formData.get("sku") ?? "").trim();
  const entry = await prisma.countEntry.findUnique({
    where: { id: entryId },
    include: { session: true },
  });
  if (!entry) throw new Error("Entry not found.");
  if (entry.session.status === "POSTED") throw new Error("This count is already posted.");

  const product = await prisma.product.findUnique({ where: { sku } });
  if (!product) throw new Error(`No product with SKU "${sku}".`);

  await prisma.countEntry.update({
    where: { id: entryId },
    data: { productId: product.id, rawSku: null },
  });
  revalidatePath(`/count/${entry.sessionId}/review`);
  revalidatePath(`/count/${entry.sessionId}`);
}

/**
 * Post the count: for each (product, location) write a COUNT ledger row equal to
 * `counted − current derived on-hand`, tagged with the session. Blocks while any
 * entry is unmatched. MANAGER/ADMIN only.
 */
export async function postSession(formData: FormData): Promise<void> {
  const user = await getViewer();
  requireCan(user, "count:post");

  const id = String(formData.get("sessionId") ?? "");
  const session = await prisma.countSession.findUnique({
    where: { id },
    include: { entries: true },
  });
  if (!session) throw new Error("Session not found.");
  if (session.status === "POSTED") throw new Error("This count is already posted.");
  if (session.status === "CANCELLED") throw new Error("A cancelled count cannot be posted.");

  const unmatched = session.entries.filter((e) => !e.productId);
  if (unmatched.length) {
    throw new Error(`Map ${unmatched.length} unmatched item(s) before posting.`);
  }

  const agg = aggregateCounts(
    session.entries.map((e) => ({
      productId: e.productId,
      locationId: e.locationId,
      condition: e.condition,
      qty: e.qty,
    }))
  );
  const productIds = [...new Set(session.entries.map((e) => e.productId!))];
  const derived = await onHandByProductLocation(productIds);

  await prisma.$transaction(async (tx) => {
    for (const a of agg) {
      if (!a.productId) continue;
      // New and show-good stock in one bin are separate slots: each is reconciled
      // against its own derived on-hand, so counting one never zeroes the other.
      const current =
        derived.get(productLocationKey(a.productId, a.locationId, a.condition)) ?? 0;
      const delta = a.counted - current;
      if (delta !== 0) {
        await tx.inventoryLedger.create({
          data: {
            productId: a.productId,
            locationId: a.locationId, // null = warehouse level (bases)
            condition: a.condition,
            qtyDelta: delta,
            reason: "COUNT",
            note: `Count "${session.label}" set ${
              a.condition === "SHOW_GOOD" ? "show-good " : ""
            }on-hand to ${a.counted}`,
            countSessionId: session.id,
            createdById: user!.id,
          },
        });
      }
    }
    await tx.countSession.update({
      where: { id },
      data: { status: "POSTED", postedById: user!.id, postedAt: new Date() },
    });
  });

  revalidatePath("/count");
  revalidatePath(`/count/${id}`);
  revalidatePath("/inventory");
  redirect(`/count/${id}`);
}
