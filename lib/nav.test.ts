import { describe, it, expect } from "vitest";
import type { UserRole } from "@prisma/client";
import { NAV_ITEMS } from "./nav";
import { SEED_GRANTS_BY_ROLE } from "./permissions/catalog";
import { resolvePermissions } from "./permissions/resolve";

// Non-admin roles (ADMIN is a superuser and sees everything — checked separately).
const ROLES: UserRole[] = [
  "STAFF", "MANAGER", "SALES", "ACCOUNTING", "MFG_MANAGER",
  "WATERJET", "RETURNS", "DRIVER", "CSR", "EXECUTIVE", "PGI_SALES",
];

// The INTENDED visibility per nav href (non-ADMIN roles that should see the link).
// Locks today's nav + the two deliberate Wave-1 reconciliations:
//  • /inventory: today shows to ALL; now matches the page guard (inventory.view =
//    10 roles) so PGI_SALES no longer sees a link they can't open.
//  • /admin/data & /admin/settings: kept at MANAGER (their real page access), not
//    the ADMIN-only legacy capability declarations.
const EXPECTED: Record<string, UserRole[]> = {
  "/orders": ["SALES", "CSR", "MANAGER"],
  "/sales-entry/new": ["PGI_SALES", "MANAGER"],
  "/sales-entry": ["PGI_SALES", "MANAGER"],
  "/orders/netsuite-review": ["ACCOUNTING", "MANAGER"],
  "/scheduling": ["CSR", "MANAGER"],
  "/floor": ["STAFF", "MANAGER", "CSR", "DRIVER"],
  "/staging": ["STAFF", "MANAGER"],
  "/qc": ["MANAGER"],
  "/dispatch": ["DRIVER", "MANAGER"],
  "/count": ["STAFF", "MANAGER"],
  "/inventory": ["STAFF", "MANAGER", "SALES", "CSR", "ACCOUNTING", "MFG_MANAGER", "WATERJET", "RETURNS", "DRIVER", "EXECUTIVE"],
  "/inventory/dashboard": ["MANAGER", "EXECUTIVE"],
  "/manufacturing": ["MFG_MANAGER", "MANAGER"],
  "/glass": ["WATERJET", "MANAGER"],
  "/transfers": ["STAFF", "MANAGER"],
  "/returns": ["RETURNS", "MANAGER"],
  "/events": ["MANAGER", "EXECUTIVE"],
  "/dashboard": ["MANAGER", "EXECUTIVE"],
  "/manufacturing/report": ["MFG_MANAGER", "MANAGER"],
  "/admin": ["MANAGER"],
  "/admin/employees": [],
  "/admin/regions": [],
  "/admin/users": [],
  "/admin/roles": [],
  "/admin/data": ["MANAGER"],
  "/admin/locations": ["MANAGER"],
  "/admin/manufacturing": ["MANAGER"],
  "/admin/price-lists": ["MANAGER"],
  "/admin/settings": ["MANAGER"],
};

function visibleRolesFor(resource: string): UserRole[] {
  const key = `${resource}:view`;
  return ROLES.filter((r) => resolvePermissions([r], SEED_GRANTS_BY_ROLE).has(key));
}

describe("nav visibility derives from the permission catalog", () => {
  it("every nav item maps to the intended visible-role set", () => {
    for (const item of NAV_ITEMS) {
      if (!item.resource) continue; // always-visible (Home, profile)
      const expected = EXPECTED[item.href];
      expect(expected, `missing EXPECTED for ${item.href}`).toBeDefined();
      expect(
        new Set(visibleRolesFor(item.resource)),
        `visibility of ${item.href} (${item.resource})`
      ).toEqual(new Set(expected));
    }
  });

  it("ADMIN sees every nav item (superuser)", () => {
    const perms = resolvePermissions(["ADMIN"], SEED_GRANTS_BY_ROLE);
    for (const item of NAV_ITEMS) {
      if (!item.resource) continue;
      expect(perms.has(`${item.resource}:view`), `${item.href} for ADMIN`).toBe(true);
    }
  });

  it("Home and Your photo are always visible (no resource gate)", () => {
    expect(NAV_ITEMS.find((i) => i.href === "/")?.resource).toBeUndefined();
    expect(NAV_ITEMS.find((i) => i.href === "/profile/photo")?.resource).toBeUndefined();
  });
});
