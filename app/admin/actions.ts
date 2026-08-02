"use server";

import { revalidatePath } from "next/cache";
import { requireCan } from "@/lib/rbac";
import { getViewer } from "@/lib/permissions/engine";
import { prisma } from "@/lib/db";

export interface ResetState {
  ok?: boolean;
  message?: string;
}

/**
 * DANGER — empties the hub's product + transactional data so the Item Master can
 * be reloaded fresh (this is also the go-live hard reset). Keeps users, all
 * locations, config, and manufacturing setup. Deletes are ordered so no FK
 * Restrict constraint is hit and each parent's children cascade. Requires ADMIN
 * and the exact confirmation phrase; the user triggers it — never run it
 * automatically.
 */
export async function resetHubData(_prev: ResetState, formData: FormData): Promise<ResetState> {
  const user = await getViewer();
  try {
    requireCan(user, "admin.data:reset");
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }

  if (String(formData.get("confirm") ?? "").trim() !== "RESET") {
    return { ok: false, message: "Type RESET (all caps) to confirm." };
  }

  await prisma.$transaction(
    async (tx) => {
      await tx.order.deleteMany(); // cascades islands / lines / events / payments / documents
      await tx.deliveryTrip.deleteMany(); // cascades trip lanes
      await tx.countSession.deleteMany(); // cascades count entries
      await tx.transfer.deleteMany(); // cascades transfer lines
      await tx.returnOrder.deleteMany(); // cascades return lines
      await tx.manufacturingEntry.deleteMany(); // cascades pay
      await tx.glassMod.deleteMany();
      await tx.bomComponent.deleteMany();
      await tx.pickAlias.deleteMany();
      await tx.inventoryLedger.deleteMany();
      await tx.product.deleteMany();
    },
    { timeout: 60_000, maxWait: 10_000 }
  );

  revalidatePath("/inventory");
  revalidatePath("/admin/reset");
  return {
    ok: true,
    message: "Hub reset. Products and all transactional data cleared — import the Item Master next.",
  };
}
