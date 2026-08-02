import { describe, it, expect } from "vitest";
import type { UserRole } from "@prisma/client";
import { resolvePermissions } from "./resolve";
import { SEED_GRANTS_BY_ROLE, ALL_PERMISSION_KEYS } from "./catalog";

describe("resolvePermissions — precedence & multi-role", () => {
  it("ADMIN is a superuser (holds every declared key)", () => {
    const perms = resolvePermissions(["ADMIN"], {}, []);
    expect(perms.size).toBe(ALL_PERMISSION_KEYS.length);
    expect(perms.has("qc:signoff")).toBe(true);
    expect(perms.has("admin.users:view")).toBe(true);
  });

  it("unions the grants of all assigned roles (multi-role)", () => {
    const perms = resolvePermissions(["CSR", "ACCOUNTING"], SEED_GRANTS_BY_ROLE, []);
    expect(perms.has("scheduling:edit")).toBe(true); // from CSR
    expect(perms.has("orders.netsuite:approve")).toBe(true); // from ACCOUNTING
    // A single CSR would NOT have the ACCOUNTING-only key:
    expect(resolvePermissions(["CSR"], SEED_GRANTS_BY_ROLE, []).has("orders.netsuite:approve")).toBe(false);
  });

  it("ALLOW override adds a permission no role grants", () => {
    const base: UserRole[] = ["STAFF"];
    expect(resolvePermissions(base, SEED_GRANTS_BY_ROLE, []).has("dashboards:view")).toBe(false);
    const perms = resolvePermissions(base, SEED_GRANTS_BY_ROLE, [{ permissionKey: "dashboards:view", effect: "ALLOW" }]);
    expect(perms.has("dashboards:view")).toBe(true);
  });

  it("DENY override removes a permission a role grants", () => {
    expect(resolvePermissions(["MANAGER"], SEED_GRANTS_BY_ROLE, []).has("qc:signoff")).toBe(true);
    const perms = resolvePermissions(["MANAGER"], SEED_GRANTS_BY_ROLE, [{ permissionKey: "qc:signoff", effect: "DENY" }]);
    expect(perms.has("qc:signoff")).toBe(false);
  });

  it("DENY beats ALLOW on the same key", () => {
    const perms = resolvePermissions(["STAFF"], SEED_GRANTS_BY_ROLE, [
      { permissionKey: "dashboards:view", effect: "ALLOW" },
      { permissionKey: "dashboards:view", effect: "DENY" },
    ]);
    expect(perms.has("dashboards:view")).toBe(false);
  });

  it("ADMIN short-circuit beats a DENY override", () => {
    const perms = resolvePermissions(["ADMIN"], SEED_GRANTS_BY_ROLE, [{ permissionKey: "qc:signoff", effect: "DENY" }]);
    expect(perms.has("qc:signoff")).toBe(true);
  });

  it("a user with no roles has no permissions (default deny)", () => {
    expect(resolvePermissions([], SEED_GRANTS_BY_ROLE, []).size).toBe(0);
  });
});

describe("catalog integrity", () => {
  it("has no duplicate permission keys", () => {
    expect(ALL_PERMISSION_KEYS.length).toBe(new Set(ALL_PERMISSION_KEYS).size);
  });
});
