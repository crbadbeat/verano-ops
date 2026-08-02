"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/db";
import {
  hashPassword,
  verifyPassword,
  createSession,
  destroySession,
  getSessionUser,
} from "@/lib/auth";

const credsSchema = z.object({
  email: z.string().email("Enter a valid email"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

export type AuthState = { error?: string } | undefined;

export async function login(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const parsed = credsSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const user = await prisma.user.findUnique({
    where: { email: parsed.data.email.toLowerCase() },
  });
  if (!user || !(await verifyPassword(parsed.data.password, user.passwordHash))) {
    return { error: "Incorrect email or password" };
  }
  // Deactivated accounts can't sign in. Checked only after the password verifies
  // so it doesn't reveal which emails exist. (An already-signed-in session
  // persists until its JWT expires — see the note in admin/users/actions.)
  if (!user.active) {
    return { error: "This account has been deactivated. Contact an administrator." };
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });

  // Carry every role this person holds so hasRole is multi-role from the JWT. The
  // fine-grained permission set is resolved live from the DB by getViewer.
  const assignments = await prisma.userRoleAssignment.findMany({
    where: { userId: user.id },
    select: { role: true },
  });
  const roles = [...new Set([user.role, ...assignments.map((a) => a.role)])];

  await createSession({
    id: user.id,
    email: user.email,
    role: user.role,
    name: user.name,
    roles,
  });
  // A temp-password account must set a real password before using the app.
  if (user.mustResetPassword) redirect("/profile/password");
  redirect("/");
}

export async function register(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const parsed = credsSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const email = parsed.data.email.toLowerCase();

  // Self-registration is a one-time bootstrap: only the very first account may be
  // created this way (as ADMIN). After that, accounts are created by an admin via
  // an invite link, so registration is closed.
  const isFirst = (await prisma.user.count()) === 0;
  if (!isFirst) {
    return { error: "Self-registration is closed. Ask an administrator for an invite." };
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return { error: "An account with that email already exists" };

  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await hashPassword(parsed.data.password),
      role: "ADMIN",
      // The bootstrap admin gets its assignment row too — the invariant is that a
      // user's assignments always include their primary role.
      roleAssignments: { create: { role: "ADMIN" } },
    },
  });

  await createSession({
    id: user.id,
    email: user.email,
    role: user.role,
    name: user.name,
    roles: [user.role],
  });
  redirect("/");
}

export async function logout(): Promise<void> {
  await destroySession();
  redirect("/login");
}

export interface ChangePasswordState {
  error?: string;
  ok?: boolean;
}

/**
 * Change the signed-in user's own password. Requires the current password (a
 * temp-password holder types the temp one). Clears `mustResetPassword`, so it
 * doubles as the forced first-login reset.
 */
export async function changePassword(
  _prev: ChangePasswordState,
  formData: FormData
): Promise<ChangePasswordState> {
  const sessionUser = await getSessionUser();
  if (!sessionUser) return { error: "You're not signed in." };

  const current = String(formData.get("currentPassword") ?? "");
  const next = String(formData.get("newPassword") ?? "");
  const confirm = String(formData.get("confirmPassword") ?? "");
  if (next.length < 8) return { error: "New password must be at least 8 characters." };
  if (next !== confirm) return { error: "The new passwords don't match." };

  const user = await prisma.user.findUnique({ where: { id: sessionUser.id } });
  if (!user) return { error: "Account not found." };
  if (!(await verifyPassword(current, user.passwordHash))) {
    return { error: "Your current password is incorrect." };
  }
  if (await verifyPassword(next, user.passwordHash)) {
    return { error: "Choose a password different from your current one." };
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(next), mustResetPassword: false },
  });
  return { ok: true };
}
