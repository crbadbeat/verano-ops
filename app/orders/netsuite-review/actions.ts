"use server";

import { revalidatePath } from "next/cache";
import { getViewer } from "@/lib/permissions/engine";
import { prisma } from "@/lib/db";
import { requireCan } from "@/lib/rbac";
import { logOrderEvent } from "@/lib/orders";
import { netsuiteConfig } from "@/lib/netsuite";
import { syncNetsuiteOrders } from "@/lib/netsuite-orders-import";

// Server actions for the NetSuite order review queue. Gated by the
// orders.netsuite.review capability (ACCOUNTING + MANAGER, ADMIN implicitly).

/** Approve a synced order: it leaves the queue and enters the normal lifecycle
 *  (CONFIRMED = ready to be scheduled). */
export async function approveNetsuiteOrder(formData: FormData): Promise<void> {
  const user = await getViewer();
  requireCan(user, "orders.netsuite:approve");

  const orderId = String(formData.get("orderId") ?? "");
  if (!orderId) throw new Error("Missing order.");

  await prisma.order.update({
    where: { id: orderId },
    data: { netsuiteReviewStatus: "APPROVED", status: "CONFIRMED" },
  });
  await logOrderEvent(orderId, "NETSUITE_APPROVED", "Approved from the NetSuite review queue", user!.id);
  revalidatePath("/orders/netsuite-review");
  revalidatePath(`/orders/${orderId}`);
}

/** Flag a synced order as needing a correction on the NetSuite side. It stays in
 *  the queue (a "fix in NetSuite" list) until the next sync brings the fix in. */
export async function flagNetsuiteOrderForFix(formData: FormData): Promise<void> {
  const user = await getViewer();
  requireCan(user, "orders.netsuite:approve");

  const orderId = String(formData.get("orderId") ?? "");
  const note = String(formData.get("note") ?? "").trim();
  if (!orderId) throw new Error("Missing order.");

  await prisma.order.update({
    where: { id: orderId },
    data: { netsuiteReviewStatus: "NEEDS_NETSUITE_FIX", note: note || null },
  });
  await logOrderEvent(
    orderId,
    "NETSUITE_NEEDS_FIX",
    note ? `Flagged for NetSuite correction: ${note}` : "Flagged for correction in NetSuite",
    user!.id
  );
  revalidatePath("/orders/netsuite-review");
  revalidatePath(`/orders/${orderId}`);
}

/** Pull now instead of waiting for the 30-minute cron. */
export async function syncNetsuiteOrdersNow(): Promise<void> {
  const user = await getViewer();
  requireCan(user, "orders.netsuite:approve");
  if (!netsuiteConfig()) throw new Error("NetSuite credentials are not configured.");

  await syncNetsuiteOrders({});
  revalidatePath("/orders/netsuite-review");
}
