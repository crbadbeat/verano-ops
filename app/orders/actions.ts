"use server";

import { createHash } from "node:crypto";
import { getViewer } from "@/lib/permissions/engine";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireCan } from "@/lib/rbac";
import { matchKey } from "@/lib/alias";
import { parseFsaPdf } from "@/lib/order-parse-pdf";
import { parseConfiguratorUrl } from "@/lib/order-parse-url";
import type { ParsedOrder } from "@/lib/order-derive";
import {
  createOrderFromParsed,
  loadCatalogue,
  logOrderEvent,
  posOrderNo,
  replaceConfiguration,
} from "@/lib/orders";
import { PAYMENT_METHOD_LABEL } from "@/lib/order-payments";
import { netsuiteConfig, fetchNetsuiteOrderByTransactionId } from "@/lib/netsuite";
import { importNetsuiteOrders } from "@/lib/netsuite-orders-import";
import type { FraudCheckStatus, GasType, PaymentMethod } from "@prisma/client";

export interface OrderIntakeState {
  ok?: boolean;
  message?: string;
  warnings?: string[];
}

function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

/**
 * Agreements arrive in two prints: the long one stamps "ORDER #14454" on a cover
 * page, the short one carries no number at all. When it is missing the person
 * entering the order supplies it, because the order number is how every other
 * system finds this order.
 */
function resolveOrderNo(parsed: ParsedOrder, typed: string | null): string | null {
  const bare = (typed ?? "").trim() || parsed.header.posOrderNo || "";
  if (!bare) return null;
  parsed.header.posOrderNo = bare.replace(/^P/i, "");
  return posOrderNo(bare);
}

async function guardDuplicate(orderNo: string, bare: string | undefined): Promise<string | null> {
  const clash = await prisma.order.findFirst({
    where: { OR: [{ orderNo }, ...(bare ? [{ posOrderNo: bare }] : [])] },
    select: { orderNo: true },
  });
  return clash ? `Order ${clash.orderNo} already exists.` : null;
}

// ---- creating ---------------------------------------------------------------

/** Build an order from a signed Final Sales Agreement. The preferred path. */
export async function createOrderFromPdf(
  _prev: OrderIntakeState,
  formData: FormData
): Promise<OrderIntakeState> {
  const user = await getViewer();
  if (!user) return { ok: false, message: "Not authenticated" };
  try {
    requireCan(user, "orders:edit");
  } catch {
    return { ok: false, message: "You do not have permission to enter orders." };
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, message: "Choose the agreement PDF to upload." };
  }

  let parsed: ParsedOrder;
  let text: string;
  let digest: string;
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    digest = sha256(buffer);
    const out = await parseFsaPdf(new Uint8Array(buffer), await loadCatalogue());
    parsed = out.parsed;
    text = out.document.text;
  } catch (e) {
    return { ok: false, message: `Could not read that PDF: ${(e as Error).message}` };
  }

  const orderNo = resolveOrderNo(parsed, formData.get("orderNo") as string | null);
  if (!orderNo) {
    return {
      ok: false,
      message:
        "This agreement does not print an order number. Enter it below and upload again.",
      warnings: parsed.warnings,
    };
  }
  const duplicate = await guardDuplicate(orderNo, parsed.header.posOrderNo);
  if (duplicate) return { ok: false, message: duplicate };

  // Kept outside the redirect: redirect() signals by throwing, so it must not
  // sit inside a try that would swallow it.
  let created;
  try {
    created = await createOrderFromParsed({
      parsed,
      orderNo,
      userId: user.id,
      document: { filename: file.name, sha256: digest, extractedText: text },
    });
  } catch (e) {
    return {
      ok: false,
      message: `Could not save the order: ${(e as Error).message}`,
      warnings: parsed.warnings,
    };
  }

  revalidatePath("/orders");
  redirect(`/orders/${created.orderId}`);
}

/** Build an order from a saved configurator link. */
export async function createOrderFromUrl(
  _prev: OrderIntakeState,
  formData: FormData
): Promise<OrderIntakeState> {
  const user = await getViewer();
  if (!user) return { ok: false, message: "Not authenticated" };
  try {
    requireCan(user, "orders:edit");
  } catch {
    return { ok: false, message: "You do not have permission to enter orders." };
  }

  const url = String(formData.get("url") ?? "").trim();
  if (!url) return { ok: false, message: "Paste a configurator link." };

  const parsed = parseConfiguratorUrl(url);
  if (parsed.islands.length === 0) {
    return {
      ok: false,
      message: "That link does not describe any islands.",
      warnings: parsed.warnings,
    };
  }

  // A link carries no customer and no order number — those are typed in.
  const orderNo = resolveOrderNo(parsed, formData.get("orderNo") as string | null);
  if (!orderNo) return { ok: false, message: "Enter the POS order number." };
  const duplicate = await guardDuplicate(orderNo, parsed.header.posOrderNo);
  if (duplicate) return { ok: false, message: duplicate };

  parsed.header.customerLast = String(formData.get("customerLast") ?? "").trim() || undefined;
  parsed.header.customerFirst = String(formData.get("customerFirst") ?? "").trim() || undefined;

  let created;
  try {
    created = await createOrderFromParsed({ parsed, orderNo, userId: user.id });
  } catch (e) {
    return {
      ok: false,
      message: `Could not save the order: ${(e as Error).message}`,
      warnings: parsed.warnings,
    };
  }
  revalidatePath("/orders");
  redirect(`/orders/${created.orderId}`);
}

/** Start an empty order and build it by hand. */
export async function createOrderManually(
  _prev: OrderIntakeState,
  formData: FormData
): Promise<OrderIntakeState> {
  const user = await getViewer();
  if (!user) return { ok: false, message: "Not authenticated" };
  try {
    requireCan(user, "orders:edit");
  } catch {
    return { ok: false, message: "You do not have permission to enter orders." };
  }

  const typed = String(formData.get("orderNo") ?? "").trim();
  if (!typed) return { ok: false, message: "Enter the POS order number." };
  const orderNo = posOrderNo(typed);
  const duplicate = await guardDuplicate(orderNo, typed.replace(/^P/i, ""));
  if (duplicate) return { ok: false, message: duplicate };

  const parsed: ParsedOrder = {
    source: "MANUAL",
    header: {
      posOrderNo: typed.replace(/^P/i, ""),
      customerLast: String(formData.get("customerLast") ?? "").trim() || undefined,
      customerFirst: String(formData.get("customerFirst") ?? "").trim() || undefined,
    },
    islands: [],
    extras: [],
    items: [],
    warnings: [],
  };

  const created = await createOrderFromParsed({ parsed, orderNo, userId: user.id });
  revalidatePath("/orders");
  redirect(`/orders/${created.orderId}`);
}

// ---- maintaining ------------------------------------------------------------

/**
 * Map an unmatched line to a product — and remember it. The mapping is stored in
 * PickAlias, the hub-native scan-alias learning table, so the next order that
 * words an item this way resolves on its own.
 */
export async function mapOrderLineToProduct(formData: FormData): Promise<void> {
  const user = await getViewer();
  requireCan(user, "orders:edit");

  const lineId = String(formData.get("lineId") ?? "");
  const sku = String(formData.get("sku") ?? "").trim();
  const line = await prisma.orderLine.findUnique({ where: { id: lineId } });
  if (!line) throw new Error("Line not found");
  const product = await prisma.product.findUnique({ where: { sku } });
  if (!product) throw new Error(`No product with SKU "${sku}"`);

  const label = line.rawLabel ?? line.sku ?? "";
  await prisma.$transaction([
    prisma.pickAlias.upsert({
      where: { matchKey: matchKey(label) },
      create: {
        productId: product.id,
        sourceItem: label,
        sourceDetail: label,
        category: null,
        matchKey: matchKey(label),
      },
      update: { productId: product.id },
    }),
    prisma.orderLine.update({ where: { id: lineId }, data: { productId: product.id } }),
    prisma.orderEvent.create({
      data: {
        orderId: line.orderId,
        type: "LINE_MAPPED",
        summary: `Mapped "${label}" to ${sku}`,
        userId: user!.id,
      },
    }),
  ]);

  revalidatePath(`/orders/${line.orderId}`);
}

export async function setOrderLineQty(formData: FormData): Promise<void> {
  const user = await getViewer();
  requireCan(user, "orders:edit");

  const lineId = String(formData.get("lineId") ?? "");
  const qty = Math.round(Number(formData.get("qty")));
  if (!Number.isFinite(qty) || qty < 0) throw new Error("Enter a whole quantity.");

  const line = await prisma.orderLine.findUnique({ where: { id: lineId } });
  if (!line) throw new Error("Line not found");
  if (qty === line.qty) return;

  await prisma.orderLine.update({ where: { id: lineId }, data: { qty } });
  await logOrderEvent(
    line.orderId,
    "LINE_QTY_CHANGED",
    `${line.rawLabel ?? line.sku}: ${line.qty} → ${qty}`,
    user!.id
  );
  revalidatePath(`/orders/${line.orderId}`);
}

export async function addOrderLine(formData: FormData): Promise<void> {
  const user = await getViewer();
  requireCan(user, "orders:edit");

  const orderId = String(formData.get("orderId") ?? "");
  const sku = String(formData.get("sku") ?? "").trim();
  const qty = Math.max(1, Math.round(Number(formData.get("qty")) || 1));
  const product = await prisma.product.findUnique({ where: { sku } });
  if (!product) throw new Error(`No product with SKU "${sku}"`);

  await prisma.orderLine.create({
    data: { orderId, origin: "MANUAL", productId: product.id, sku, rawLabel: product.name, qty },
  });
  await logOrderEvent(orderId, "LINE_ADDED", `Added ${qty} × ${sku}`, user!.id);
  revalidatePath(`/orders/${orderId}`);
}

export async function removeOrderLine(formData: FormData): Promise<void> {
  const user = await getViewer();
  requireCan(user, "orders:edit");

  const lineId = String(formData.get("lineId") ?? "");
  const line = await prisma.orderLine.findUnique({ where: { id: lineId } });
  if (!line) return;

  await prisma.orderLine.delete({ where: { id: lineId } });
  await logOrderEvent(
    line.orderId,
    "LINE_REMOVED",
    `Removed ${line.qty} × ${line.sku ?? line.rawLabel}`,
    user!.id
  );
  revalidatePath(`/orders/${line.orderId}`);
}

export async function setOrderStatus(formData: FormData): Promise<void> {
  const user = await getViewer();
  requireCan(user, "orders:edit");

  const orderId = String(formData.get("orderId") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!["DRAFT", "CONFIRMED", "CANCELLED"].includes(status)) {
    // SCHEDULED and everything past it belong to the Scheduling section, which
    // owns those transitions; they are not settable by hand here.
    throw new Error("That status is not settable from the order screen.");
  }

  await prisma.order.update({
    where: { id: orderId },
    data: { status: status as "DRAFT" | "CONFIRMED" | "CANCELLED" },
  });
  await logOrderEvent(orderId, "STATUS_CHANGED", `Status set to ${status}`, user!.id);
  revalidatePath(`/orders/${orderId}`);
  revalidatePath("/orders");
}

export async function updateOrderHeader(formData: FormData): Promise<void> {
  const user = await getViewer();
  requireCan(user, "orders:edit");

  const orderId = String(formData.get("orderId") ?? "");
  const netsuiteOrderNo = String(formData.get("netsuiteOrderNo") ?? "").trim();
  const note = String(formData.get("note") ?? "").trim();

  await prisma.order.update({
    where: { id: orderId },
    data: {
      netsuiteOrderNo: netsuiteOrderNo || null,
      note: note || null,
    },
  });
  await logOrderEvent(
    orderId,
    "HEADER_UPDATED",
    netsuiteOrderNo
      ? `NetSuite order number set to ${netsuiteOrderNo}`
      : "Order details updated",
    user!.id
  );
  revalidatePath(`/orders/${orderId}`);
}

// ---- payments ---------------------------------------------------------------

function centsFrom(raw: FormDataEntryValue | null): number {
  const n = Number(String(raw ?? "").replace(/[$,\s]/g, ""));
  if (!Number.isFinite(n)) throw new Error("Enter the amount as a number.");
  return Math.round(n * 100);
}

/**
 * Record money taken. Entered rather than parsed, because the METHOD matters:
 * a cheque or wire costs us nothing while a card or GreenSky carries a fee, and
 * that is what decides the rep's Paid In Full 1%.
 */
export async function addOrderPayment(formData: FormData): Promise<void> {
  const user = await getViewer();
  requireCan(user, "orders:edit");

  const orderId = String(formData.get("orderId") ?? "");
  const method = String(formData.get("method") ?? "") as PaymentMethod;
  if (!["CHECK", "WIRE_TRANSFER", "CREDIT_CARD", "GREENSKY"].includes(method)) {
    throw new Error("Choose how the payment was made.");
  }
  const amountCents = centsFrom(formData.get("amount"));
  if (amountCents === 0) throw new Error("Enter an amount other than zero.");

  const reference = String(formData.get("reference") ?? "").trim();
  const receivedRaw = String(formData.get("receivedAt") ?? "").trim();

  await prisma.orderPayment.create({
    data: {
      orderId,
      method,
      amountCents,
      reference: reference || null,
      receivedAt: receivedRaw ? new Date(`${receivedRaw}T00:00:00Z`) : null,
      createdById: user!.id,
    },
  });

  await logOrderEvent(
    orderId,
    "PAYMENT_ADDED",
    `${PAYMENT_METHOD_LABEL[method]} ${(amountCents / 100).toLocaleString("en-US", {
      style: "currency",
      currency: "USD",
    })}${reference ? ` (${reference})` : ""}`,
    user!.id
  );
  revalidatePath(`/orders/${orderId}`);
}

export async function removeOrderPayment(formData: FormData): Promise<void> {
  const user = await getViewer();
  requireCan(user, "orders:edit");

  const paymentId = String(formData.get("paymentId") ?? "");
  const payment = await prisma.orderPayment.findUnique({ where: { id: paymentId } });
  if (!payment) return;

  await prisma.orderPayment.delete({ where: { id: paymentId } });
  await logOrderEvent(
    payment.orderId,
    "PAYMENT_REMOVED",
    `Removed ${PAYMENT_METHOD_LABEL[payment.method]} ${(
      payment.amountCents / 100
    ).toLocaleString("en-US", { style: "currency", currency: "USD" })}`,
    user!.id
  );
  revalidatePath(`/orders/${payment.orderId}`);
}

/**
 * Set (or clear) the Paid In Full 1% flag.
 *
 * The app can see that an order LOOKS eligible — paid in full with no more than
 * $1,000 on a card — but there are timing conditions only the employee can
 * verify, so this is always their answer, never a computed value. It stays
 * editable so a mislabelled order can be put right.
 */
export async function setPaidInFullOnePercent(formData: FormData): Promise<void> {
  const user = await getViewer();
  requireCan(user, "orders:edit");

  const orderId = String(formData.get("orderId") ?? "");
  const qualifies = formData.get("qualifies") === "1";

  await prisma.order.update({
    where: { id: orderId },
    data: {
      paidInFullOnePercent: qualifies,
      paidInFullConfirmedAt: new Date(),
      paidInFullConfirmedById: user!.id,
    },
  });
  await logOrderEvent(
    orderId,
    "PAID_IN_FULL_1PCT",
    qualifies
      ? "Confirmed as Paid In Full 1% — rep earns the extra 1%"
      : "Marked as NOT qualifying for Paid In Full 1%",
    user!.id
  );
  revalidatePath(`/orders/${orderId}`);
}

// ---- commercial flags and the fraud check -----------------------------------

export async function setOrderFlags(formData: FormData): Promise<void> {
  const user = await getViewer();
  requireCan(user, "orders:edit");

  const orderId = String(formData.get("orderId") ?? "");
  const before = await prisma.order.findUnique({
    where: { id: orderId },
    select: { taxFree: true, freightInTotal: true, veranoForLife: true, gasType: true },
  });
  if (!before) throw new Error("Order not found");

  const gasRaw = String(formData.get("gasType") ?? "");
  const after = {
    taxFree: formData.get("taxFree") === "on",
    freightInTotal: formData.get("freightInTotal") === "on",
    veranoForLife: formData.get("veranoForLife") === "on",
    gasType: gasRaw === "LP" || gasRaw === "NG" ? (gasRaw as GasType) : null,
  };

  await prisma.order.update({ where: { id: orderId }, data: after });

  const changed = (Object.keys(after) as (keyof typeof after)[])
    .filter((k) => before[k] !== after[k])
    .map((k) => `${k}: ${String(before[k])} → ${String(after[k])}`);
  if (changed.length) {
    await logOrderEvent(orderId, "FLAGS_CHANGED", changed.join(", "), user!.id);
  }
  revalidatePath(`/orders/${orderId}`);
}

/**
 * Resolve the manual fraud check on an order whose billing and delivery
 * addresses differ. The full Fraud Queue — and whatever of it can be automated —
 * is a later step; this records the decision so nothing ships unreviewed.
 */
export async function resolveFraudCheck(formData: FormData): Promise<void> {
  const user = await getViewer();
  requireCan(user, "orders:approve");

  const orderId = String(formData.get("orderId") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!["REQUIRED", "CLEARED", "REJECTED"].includes(status)) {
    throw new Error("Choose an outcome for the fraud check.");
  }
  const note = String(formData.get("fraudCheckNote") ?? "").trim();

  await prisma.order.update({
    where: { id: orderId },
    data: { fraudCheckStatus: status as FraudCheckStatus, fraudCheckNote: note || null },
  });
  await logOrderEvent(
    orderId,
    "FRAUD_CHECK",
    `Fraud check ${status.toLowerCase()}${note ? ` — ${note}` : ""}`,
    user!.id
  );
  revalidatePath(`/orders/${orderId}`);
  revalidatePath("/orders");
}

// ---- addendums --------------------------------------------------------------

/**
 * Apply a re-issued agreement. Everything the configuration owns is rebuilt from
 * the new document; lines someone added by hand are left alone, because an
 * addendum re-states the sale, not the warehouse's own notes.
 */
export async function applyAddendum(
  _prev: OrderIntakeState,
  formData: FormData
): Promise<OrderIntakeState> {
  const user = await getViewer();
  if (!user) return { ok: false, message: "Not authenticated" };
  try {
    requireCan(user, "orders:edit");
  } catch {
    return { ok: false, message: "You do not have permission to change orders." };
  }

  const orderId = String(formData.get("orderId") ?? "");
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { id: true, documents: { select: { sha256: true } } },
  });
  if (!order) return { ok: false, message: "Order not found" };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, message: "Choose the addendum PDF to upload." };
  }

  let parsed: ParsedOrder;
  let text: string;
  let digest: string;
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    digest = sha256(buffer);
    const out = await parseFsaPdf(new Uint8Array(buffer), await loadCatalogue());
    parsed = out.parsed;
    text = out.document.text;
  } catch (e) {
    return { ok: false, message: `Could not read that PDF: ${(e as Error).message}` };
  }

  if (order.documents.some((d) => d.sha256 === digest)) {
    return { ok: false, message: "That exact file has already been applied to this order." };
  }

  let result;
  try {
    result = await replaceConfiguration(orderId, parsed, user.id, {
      filename: file.name,
      sha256: digest,
      extractedText: text,
    });
  } catch (e) {
    return {
      ok: false,
      message: `Could not apply the addendum: ${(e as Error).message}`,
      warnings: parsed.warnings,
    };
  }

  revalidatePath(`/orders/${orderId}`);
  return {
    ok: true,
    message: `Addendum applied: ${result.added.length} line(s) added, ${result.removed.length} removed.`,
    warnings: result.derived.warnings,
  };
}

// ---- deleting ---------------------------------------------------------------

/**
 * Delete an order outright — for one entered in error or imported twice. Islands,
 * lines, payments, documents and the activity log all cascade off it.
 *
 * Note this is NOT how a real sale that fell through is handled: that is
 * `status = CANCELLED`, which keeps the record. Deleting also frees the order
 * number so the agreement can be imported again.
 *
 * Products the order auto-created are cleaned up too, but only when they are
 * genuinely orphaned — never linked to NetSuite, never used by another order,
 * and with no stock history. Otherwise the NetSuite queue slowly fills with
 * leftovers from mistakes.
 */
export async function deleteOrder(formData: FormData): Promise<void> {
  const user = await getViewer();
  requireCan(user, "orders:edit");

  const orderId = String(formData.get("orderId") ?? "");
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      islands: { select: { baseProductId: true, topProductId: true } },
      lines: { select: { productId: true } },
    },
  });
  if (!order) redirect("/orders");

  const touched = new Set(
    [
      ...order.islands.flatMap((i) => [i.baseProductId, i.topProductId]),
      ...order.lines.map((l) => l.productId),
    ].filter((id): id is string => !!id)
  );

  await prisma.order.delete({ where: { id: orderId } });

  // Now that the order is gone, anything of its making that nothing else needs.
  for (const productId of touched) {
    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: {
        id: true,
        netsuiteLinkedAt: true,
        _count: {
          select: {
            ledgerEntries: true,
            orderLines: true,
            orderIslandBases: true,
            orderIslandTops: true,
            countEntries: true,
            transferLines: true,
            returnLines: true,
            aliases: true,
          },
        },
      },
    });
    if (!product || product.netsuiteLinkedAt) continue;
    const stillUsed = Object.values(product._count).some((n) => n > 0);
    if (stillUsed) continue;
    await prisma.product.delete({ where: { id: product.id } });
  }

  revalidatePath("/orders");
  redirect("/orders");
}

// ---- the decode catalogue ---------------------------------------------------

/**
 * Switch a decode option on or off.
 *
 * The built-in tables define what every option MEANS; a stored row only carries
 * this flag (or, for an option that does not exist in code yet, its whole
 * definition). So turning one off is an upsert — there may be no row yet.
 */
export async function setConfigOptionActive(formData: FormData): Promise<void> {
  const user = await getViewer();
  requireCan(user, "catalog:edit");

  const param = String(formData.get("param") ?? "");
  const code = String(formData.get("code") ?? "");
  const label = String(formData.get("label") ?? "");
  const active = formData.get("active") === "1";
  if (!param || !code) throw new Error("Which option?");

  await prisma.configOption.upsert({
    where: { param_code: { param, code } },
    create: { param, code, label, aliases: [], active },
    update: { active },
  });
  revalidatePath("/orders/catalogue");
}

// ---- NetSuite match queue ---------------------------------------------------

/** Tie an auto-created product to its NetSuite item, clearing it from the queue. */
export async function linkProductToNetsuite(formData: FormData): Promise<void> {
  const user = await getViewer();
  requireCan(user, "catalog:edit");

  const productId = String(formData.get("productId") ?? "");
  const netsuiteNumber = String(
    formData.get("netsuiteNumber") ?? formData.get("netsuiteItemId") ?? ""
  ).trim();
  if (!netsuiteNumber) throw new Error("Enter the NetSuite item number.");

  await prisma.product.update({
    where: { id: productId },
    data: { netsuiteNumber, netsuiteLinkedAt: new Date() },
  });
  revalidatePath("/inventory/netsuite-queue");
}

// ---- NetSuite single-order re-sync -----------------------------------------

/** Re-pull one NetSuite-sourced order on demand — the "Sync from NetSuite" button.
 *  Lets someone fix an order in NetSuite, update it here, then Confirm. */
export async function syncSingleNetsuiteOrder(formData: FormData): Promise<void> {
  const user = await getViewer();
  requireCan(user, "orders:manage");

  const orderId = String(formData.get("orderId") ?? "");
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { netsuiteTransactionId: true },
  });
  if (!order?.netsuiteTransactionId) throw new Error("This order isn't linked to a NetSuite transaction.");
  if (!netsuiteConfig()) throw new Error("NetSuite credentials are not configured.");

  const raw = await fetchNetsuiteOrderByTransactionId(order.netsuiteTransactionId);
  if (!raw) throw new Error("This order was not found in NetSuite.");
  await importNetsuiteOrders([raw]);
  revalidatePath(`/orders/${orderId}`);
}
