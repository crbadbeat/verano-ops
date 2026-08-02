import "server-only";
import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import type { UserRole } from "@prisma/client";

const COOKIE_NAME = "pw_session";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 days

function secretKey(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error("SESSION_SECRET must be set (>=16 chars). See .env.example");
  }
  return new TextEncoder().encode(secret);
}

export interface SessionUser {
  id: string;
  email: string;
  role: UserRole; // the primary / display role (drives identity behaviours)
  name?: string | null;
  // Every role the user holds (multi-role). Carried in the JWT, bounded + safe.
  // Wave 0 populates the primary role only; Wave 4 loads the full assignment set.
  roles?: UserRole[];
}

// ---- passwords --------------------------------------------------------------

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 12);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

// ---- session cookie (signed JWT, httpOnly) ----------------------------------

export async function createSession(user: SessionUser): Promise<void> {
  // Carry the (bounded) role set so hasRole can go multi-role later without
  // re-reading the DB. Defaults to the primary role when callers don't supply it.
  const roles = user.roles?.length ? user.roles : [user.role];
  const token = await new SignJWT({ ...user, roles })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE_SECONDS}s`)
    .sign(secretKey());

  const jar = await cookies();
  jar.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  jar.delete(COOKIE_NAME);
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE_NAME)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey());
    const role = payload.role as UserRole;
    const rawRoles = payload.roles as UserRole[] | undefined;
    return {
      id: payload.id as string,
      email: payload.email as string,
      role,
      name: (payload.name as string) ?? null,
      // Old tokens (issued before multi-role) have no `roles` claim → fall back.
      roles: rawRoles?.length ? rawRoles : [role],
    };
  } catch {
    return null;
  }
}

// ---- authorization ----------------------------------------------------------
// Role is carried in the session JWT, so checks are cheap and run inside each
// server action / page (proxy.ts only verifies the signature). ADMIN is a
// superuser and passes every check. NOTE: a role change takes effect on the
// user's next sign-in (the JWT is reissued at login).

/** True if the user holds one of `roles` (ADMIN always qualifies). Multi-role:
 *  matches against the whole assigned set carried in the JWT (falling back to the
 *  primary role for pre-multi-role tokens). This stays the cheap in-memory bridge;
 *  the live, fine-grained layer is the permission engine (getViewer / can). */
export function hasRole(user: SessionUser | null, roles: UserRole[]): boolean {
  if (!user) return false;
  const held = user.roles?.length ? user.roles : [user.role];
  if (held.includes("ADMIN")) return true;
  return held.some((r) => roles.includes(r));
}

/** Throw unless the user holds one of `roles` (ADMIN always allowed). */
export function requireRole(
  user: SessionUser | null,
  roles: UserRole[]
): SessionUser {
  if (!user) throw new Error("Not authenticated");
  if (!hasRole(user, roles)) throw new Error("Not authorized");
  return user;
}
