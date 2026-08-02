"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { hashPassword, createSession } from "@/lib/auth";
import { hashInviteToken } from "@/lib/invite";

export interface SetPasswordState {
  error?: string;
}

const schema = z
  .object({
    token: z.string().min(1),
    password: z.string().min(8, "Password must be at least 8 characters"),
    confirm: z.string(),
  })
  .refine((d) => d.password === d.confirm, {
    message: "Passwords do not match",
    path: ["confirm"],
  });

/**
 * Redeem an invite / reset token: the user sets their own password, the token is
 * spent, and they land signed in. Re-validates the token server-side (the page
 * only gates rendering), so a stale link can never set a password.
 */
export async function setPassword(
  _prev: SetPasswordState,
  formData: FormData
): Promise<SetPasswordState> {
  const parsed = schema.safeParse({
    token: formData.get("token"),
    password: formData.get("password"),
    confirm: formData.get("confirm"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const tokenHash = hashInviteToken(parsed.data.token);
  const record = await prisma.passwordResetToken.findUnique({
    where: { tokenHash },
    include: { user: true },
  });
  if (!record || record.usedAt || record.expiresAt < new Date()) {
    return {
      error: "This link has expired or was already used. Ask an administrator for a new one.",
    };
  }
  if (!record.user.active) {
    return { error: "This account is deactivated. Contact an administrator." };
  }

  const passwordHash = await hashPassword(parsed.data.password);
  await prisma.$transaction([
    prisma.user.update({
      where: { id: record.userId },
      data: { passwordHash, mustResetPassword: false, lastLoginAt: new Date() },
    }),
    prisma.passwordResetToken.update({
      where: { id: record.id },
      data: { usedAt: new Date() },
    }),
  ]);

  const assignments = await prisma.userRoleAssignment.findMany({
    where: { userId: record.userId },
    select: { role: true },
  });
  const roles = [...new Set([record.user.role, ...assignments.map((a) => a.role)])];

  await createSession({
    id: record.user.id,
    email: record.user.email,
    role: record.user.role,
    name: record.user.name,
    roles,
  });
  redirect("/");
}
