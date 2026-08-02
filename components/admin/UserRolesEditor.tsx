"use client";

import { useMemo, useState } from "react";
import type { UserRole } from "@prisma/client";
import { resolvePermissions } from "@/lib/permissions/resolve";

type RoleOpt = { value: string; label: string };
type Override = { permissionKey: string; effect: "ALLOW" | "DENY" };

/**
 * The role side of a user's access: a primary position + any additional positions
 * ("many hats"), with a LIVE preview of the effective permission set. The preview
 * uses the same pure resolver as the server engine — selected roles' grants, minus
 * DENY overrides, plus ALLOW overrides — so "what Jane actually gets" is exact.
 *
 * Rendered inside the updateUser form: `role` (primary select) + one hidden
 * `extraRoles` input per additional position drive the write; the visible extra
 * checkboxes carry no name and are display-only.
 */
export default function UserRolesEditor({
  primaryRole,
  assignedRoles,
  allRoles,
  grantsByRole,
  overrides,
  menuResources,
  keyLabel,
}: {
  primaryRole: string;
  assignedRoles: string[];
  allRoles: RoleOpt[];
  grantsByRole: Record<string, string[]>;
  overrides: Override[];
  menuResources: { resource: string; label: string }[];
  keyLabel: Record<string, string>;
}) {
  const [primary, setPrimary] = useState(primaryRole);
  const [extra, setExtra] = useState<Set<string>>(
    () => new Set(assignedRoles.filter((r) => r !== primaryRole))
  );

  function changePrimary(next: string) {
    setPrimary(next);
    // The primary is implied by the assignment set; never also list it as "extra".
    setExtra((prev) => {
      if (!prev.has(next)) return prev;
      const n = new Set(prev);
      n.delete(next);
      return n;
    });
  }
  function toggleExtra(role: string) {
    setExtra((prev) => {
      const n = new Set(prev);
      if (n.has(role)) n.delete(role);
      else n.add(role);
      return n;
    });
  }

  const resolved = useMemo(
    () =>
      resolvePermissions(
        [primary, ...extra] as UserRole[],
        grantsByRole as Partial<Record<UserRole, string[]>>,
        overrides
      ),
    [primary, extra, grantsByRole, overrides]
  );

  const visibleMenus = menuResources.filter((m) => resolved.has(`${m.resource}:view`));
  const resolvedLabels = useMemo(
    () => [...resolved].map((k) => keyLabel[k] ?? k).sort((a, b) => a.localeCompare(b)),
    [resolved, keyLabel]
  );

  return (
    <div className="space-y-3">
      <div className="grid sm:grid-cols-2 gap-3">
        <label className="text-sm">
          <span className="text-muted">Primary position</span>
          <select
            name="role"
            value={primary}
            onChange={(e) => changePrimary(e.target.value)}
            className="input mt-1"
          >
            {allRoles.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </label>
        <fieldset className="text-sm">
          <legend className="text-muted mb-1">Also holds (extra positions)</legend>
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            {allRoles
              .filter((r) => r.value !== primary)
              .map((r) => (
                <label key={r.value} className="inline-flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={extra.has(r.value)}
                    onChange={() => toggleExtra(r.value)}
                  />
                  <span>{r.label}</span>
                </label>
              ))}
          </div>
        </fieldset>
      </div>

      {/* Decoupled submission of the additional positions (primary rides `role`). */}
      {[...extra].map((r) => (
        <input key={r} type="hidden" name="extraRoles" value={r} />
      ))}

      <div className="card bg-muted/5 p-3 text-sm">
        <div className="font-medium">
          Effective access{" "}
          <span className="text-muted font-normal">
            · {resolved.size} permission{resolved.size === 1 ? "" : "s"} · {visibleMenus.length} menu
            area{visibleMenus.length === 1 ? "" : "s"}
          </span>
        </div>
        {visibleMenus.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {visibleMenus.map((m) => (
              <span key={m.resource} className="badge text-muted text-xs">
                {m.label}
              </span>
            ))}
          </div>
        ) : (
          <p className="mt-1 text-muted">No menu areas — this person would see only Home.</p>
        )}
        {resolvedLabels.length > 0 && (
          <details className="mt-2">
            <summary className="cursor-pointer text-xs text-teal">Show all permissions</summary>
            <ul className="mt-1 columns-2 gap-4 text-xs text-muted">
              {resolvedLabels.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          </details>
        )}
        <p className="mt-2 text-xs text-muted">
          Live preview from the selected positions + saved overrides. Saving applies it on their next
          page load.
        </p>
      </div>
    </div>
  );
}
