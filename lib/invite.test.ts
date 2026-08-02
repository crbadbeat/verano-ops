import { describe, it, expect } from "vitest";
import {
  hashInviteToken,
  generateInviteToken,
  randomUnusableSecret,
  INVITE_TTL_DAYS,
} from "./invite";

describe("invite tokens", () => {
  it("hashes a token deterministically as sha256 hex", () => {
    // Known sha256("abc").
    expect(hashInviteToken("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
    expect(hashInviteToken("abc")).toBe(hashInviteToken("abc"));
    expect(hashInviteToken("abc")).not.toBe(hashInviteToken("abd"));
  });

  it("generates a token whose stored hash matches the raw token", () => {
    const invite = generateInviteToken();
    expect(invite.tokenHash).toBe(hashInviteToken(invite.token));
    // URL-safe (base64url has no +/=), and plenty of entropy.
    expect(invite.token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(invite.token.length).toBeGreaterThanOrEqual(40);
  });

  it("sets expiry the default TTL out, in the future", () => {
    const before = Date.now();
    const invite = generateInviteToken();
    const ms = invite.expiresAt.getTime() - before;
    const day = 24 * 60 * 60 * 1000;
    expect(ms).toBeGreaterThan((INVITE_TTL_DAYS - 1) * day);
    expect(ms).toBeLessThanOrEqual(INVITE_TTL_DAYS * day + 1000);
  });

  it("honours a custom TTL", () => {
    const before = Date.now();
    const invite = generateInviteToken(1);
    const ms = invite.expiresAt.getTime() - before;
    expect(ms).toBeLessThanOrEqual(24 * 60 * 60 * 1000 + 1000);
  });

  it("mints distinct tokens each call", () => {
    const a = generateInviteToken();
    const b = generateInviteToken();
    expect(a.token).not.toBe(b.token);
  });

  it("makes an unusable secret that is unpredictable hex", () => {
    expect(randomUnusableSecret()).toMatch(/^[0-9a-f]{48}$/);
    expect(randomUnusableSecret()).not.toBe(randomUnusableSecret());
  });
});
