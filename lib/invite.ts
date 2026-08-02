import "server-only";
import { randomBytes, createHash } from "node:crypto";

// -----------------------------------------------------------------------------
// Invite / password-reset tokens. The admin never types a user's password: they
// mint a single-use token, the user follows the link and sets their own. Only a
// HASH of the token is stored (PasswordResetToken.tokenHash), so a database leak
// never exposes a working link. Tokens are high-entropy random, so a plain
// sha256 is the right store — bcrypt's slow hashing is for low-entropy secrets
// and cannot be looked up by value.
// -----------------------------------------------------------------------------

export const INVITE_TTL_DAYS = 7;

/** Hash a raw invite/reset token for storage and lookup. */
export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export interface GeneratedInvite {
  /** The raw token — shown once, inside the invite link. Never stored. */
  token: string;
  /** What we persist (PasswordResetToken.tokenHash). */
  tokenHash: string;
  expiresAt: Date;
}

/** Mint a fresh single-use invite: raw token + stored hash + expiry. */
export function generateInviteToken(ttlDays: number = INVITE_TTL_DAYS): GeneratedInvite {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000);
  return { token, tokenHash: hashInviteToken(token), expiresAt };
}

/**
 * A random secret to bcrypt into an unusable passwordHash. A freshly-invited (or
 * password-reset) account gets one of these, so the account cannot be logged
 * into until its owner redeems the invite and sets a real password — no
 * "temporary password" that an admin knows ever exists.
 */
export function randomUnusableSecret(): string {
  return randomBytes(24).toString("hex");
}
