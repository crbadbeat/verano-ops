"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getViewer } from "@/lib/permissions/engine";
import { can } from "@/lib/rbac";

// Profile-photo actions. An admin (admin.employees) may set any employee's photo;
// anyone may set their OWN (the employee linked to their login). The cropped image
// arrives as a small square blob and is stored inline on the Employee row.

const MAX_BYTES = 1_500_000;
const OK_MIME = new Set(["image/webp", "image/jpeg", "image/png"]);

export interface AvatarState {
  ok?: boolean;
  message?: string;
}

async function authorize(employeeId: string) {
  const user = await getViewer();
  if (!user) return { user: null, employee: null, allowed: false };
  const employee = await prisma.employee.findUnique({ where: { id: employeeId }, select: { id: true, userId: true } });
  if (!employee) return { user, employee: null, allowed: false };
  const allowed = can(user, "admin.employees:view") || (employee.userId != null && employee.userId === user.id);
  return { user, employee, allowed };
}

export async function uploadAvatar(_prev: AvatarState, formData: FormData): Promise<AvatarState> {
  const employeeId = String(formData.get("employeeId") ?? "");
  if (!employeeId) return { ok: false, message: "Missing employee." };
  const { allowed } = await authorize(employeeId);
  if (!allowed) return { ok: false, message: "You can only change your own photo." };

  const file = formData.get("image");
  if (!(file instanceof Blob) || file.size === 0) return { ok: false, message: "No image supplied." };
  if (file.size > MAX_BYTES) return { ok: false, message: "Image is too large — try zooming out or re-cropping." };
  const mime = file.type || "image/webp";
  if (!OK_MIME.has(mime)) return { ok: false, message: "Unsupported image type." };

  const buf = Buffer.from(await file.arrayBuffer());
  await prisma.employee.update({
    where: { id: employeeId },
    data: { avatar: buf, avatarMime: mime, avatarUpdatedAt: new Date() },
  });
  revalidatePath(`/admin/employees/${employeeId}`);
  revalidatePath("/profile/photo");
  return { ok: true, message: "Photo saved." };
}

export async function removeAvatar(_prev: AvatarState, formData: FormData): Promise<AvatarState> {
  const employeeId = String(formData.get("employeeId") ?? "");
  if (!employeeId) return { ok: false, message: "Missing employee." };
  const { allowed } = await authorize(employeeId);
  if (!allowed) return { ok: false, message: "You can only change your own photo." };

  await prisma.employee.update({
    where: { id: employeeId },
    data: { avatar: null, avatarMime: null, avatarUpdatedAt: null },
  });
  revalidatePath(`/admin/employees/${employeeId}`);
  revalidatePath("/profile/photo");
  return { ok: true, message: "Photo removed." };
}
