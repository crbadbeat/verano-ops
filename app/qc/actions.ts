"use server";

import { revalidatePath } from "next/cache";
import { getViewer } from "@/lib/permissions/engine";
import { prisma } from "@/lib/db";
import { requireCan } from "@/lib/rbac";

// Management QC: a staged trip is inspected before it goes to the driver. No
// inventory moves here — QC only advances (or bounces) the trip's status. The
// qcById/qcAt/qcNote columns are the audit trail (migration 19).

function touch(tripId?: string) {
  revalidatePath("/qc");
  revalidatePath("/floor");
  if (tripId) {
    revalidatePath(`/qc/${tripId}`);
    revalidatePath(`/staging/${tripId}/confirm`);
    revalidatePath(`/dispatch/${tripId}`);
  }
}

/** Pass QC: a staged trip clears to QC_PASSED and hands off to dispatch. */
export async function passQc(formData: FormData): Promise<void> {
  const user = await getViewer();
  const actor = requireCan(user, "qc:signoff");

  const tripId = String(formData.get("tripId") ?? "");
  const qcNote = String(formData.get("qcNote") ?? "").trim() || null;

  const trip = await prisma.deliveryTrip.findUnique({ where: { id: tripId } });
  if (!trip) throw new Error("Trip not found.");
  if (trip.status !== "STAGED") throw new Error("Only a staged trip can pass QC.");

  await prisma.deliveryTrip.update({
    where: { id: tripId },
    data: { status: "QC_PASSED", qcById: actor.id, qcAt: new Date(), qcNote },
  });
  touch(tripId);
}

/**
 * Reject QC: send the trip back to picking with a reason recorded. Clears the
 * staged marker so it re-enters the pick flow; the reason rides on qcNote so the
 * picker sees what to fix.
 */
export async function rejectQc(formData: FormData): Promise<void> {
  const user = await getViewer();
  const actor = requireCan(user, "qc:signoff");

  const tripId = String(formData.get("tripId") ?? "");
  const qcNote = String(formData.get("qcNote") ?? "").trim();
  if (!qcNote) throw new Error("Say what needs fixing before rejecting.");

  const trip = await prisma.deliveryTrip.findUnique({ where: { id: tripId } });
  if (!trip) throw new Error("Trip not found.");
  if (trip.status !== "STAGED") throw new Error("Only a staged trip can be rejected.");

  await prisma.deliveryTrip.update({
    where: { id: tripId },
    data: {
      status: "STAGING",
      qcById: actor.id,
      qcAt: new Date(),
      qcNote,
      stagedAt: null,
      stagedById: null,
    },
  });
  touch(tripId);
}
