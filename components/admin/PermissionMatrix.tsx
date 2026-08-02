"use client";

import { useMemo, useState } from "react";

type Cell = { key: string; label: string; danger: boolean } | null;
type Special = { key: string; label: string; danger: boolean };
type Row = {
  key: string;
  label: string;
  isSection: boolean;
  href: string | null;
  view: Cell;
  edit: Cell;
  del: Cell;
  specials: Special[];
};
export type MatrixGroup = { id: string; label: string; rows: Row[] };

/**
 * The per-role permission matrix. Rows = catalog resources/sections (accordion by
 * menu group); columns = View / Edit / Delete + the row's named "other actions".
 *
 * `view` is the master toggle (the nav-visibility rule): turning View off clears +
 * disables the rest of the row; ticking any other verb auto-adds View. The visible
 * checkboxes are display-only (no `name`); submission is decoupled through one
 * hidden input per checked key, so what saves is exactly the resolved state.
 */
export default function PermissionMatrix({
  role,
  roleLabel,
  granted,
  groups,
  action,
  canEdit,
}: {
  role: string;
  roleLabel: string;
  granted: string[];
  groups: MatrixGroup[];
  action: (formData: FormData) => Promise<void>;
  canEdit: boolean;
}) {
  const initial = useMemo(() => new Set(granted), [granted]);
  const [checked, setChecked] = useState<Set<string>>(() => new Set(granted));

  const { viewKeyByResource, keysByResource } = useMemo(() => {
    const viewKeyByResource = new Map<string, string>();
    const keysByResource = new Map<string, string[]>();
    for (const g of groups) {
      for (const r of g.rows) {
        if (r.view) viewKeyByResource.set(r.key, r.view.key);
        keysByResource.set(
          r.key,
          [r.view?.key, r.edit?.key, r.del?.key, ...r.specials.map((s) => s.key)].filter(
            (k): k is string => !!k
          )
        );
      }
    }
    return { viewKeyByResource, keysByResource };
  }, [groups]);

  const dirty = useMemo(() => {
    if (checked.size !== initial.size) return true;
    for (const k of checked) if (!initial.has(k)) return true;
    return false;
  }, [checked, initial]);

  const resourceOf = (key: string) => key.slice(0, key.lastIndexOf(":"));

  function toggle(key: string, isViewKey: boolean) {
    setChecked((prev) => {
      const next = new Set(prev);
      const resource = resourceOf(key);
      if (next.has(key)) {
        next.delete(key);
        // Unchecking View hides the item — clear the whole row.
        if (isViewKey) for (const k of keysByResource.get(resource) ?? []) next.delete(k);
      } else {
        next.add(key);
        // Any edit/delete/special implies visibility — auto-add View.
        if (!isViewKey) {
          const vk = viewKeyByResource.get(resource);
          if (vk) next.add(vk);
        }
      }
      return next;
    });
  }

  const menuCount = useMemo(() => {
    let n = 0;
    for (const g of groups)
      for (const r of g.rows) if (r.href && r.view && checked.has(r.view.key)) n++;
    return n;
  }, [groups, checked]);

  function renderCell(cell: Cell, isView: boolean, disabled: boolean) {
    if (!cell) return <span className="text-muted/40">—</span>;
    return (
      <label
        title={`${cell.label}${cell.danger ? " (high-impact)" : ""}`}
        className={`inline-flex ${disabled ? "opacity-40" : "cursor-pointer"}`}
      >
        <input
          type="checkbox"
          className={cell.danger ? "accent-red-600" : ""}
          checked={checked.has(cell.key)}
          disabled={disabled || !canEdit}
          onChange={() => toggle(cell.key, isView)}
        />
      </label>
    );
  }

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="role" value={role} />
      {[...checked].map((k) => (
        <input key={k} type="hidden" name="key" value={k} />
      ))}

      <div className="card p-4 flex items-center gap-3 flex-wrap sticky top-2 z-10">
        <div className="min-w-0">
          <div className="font-semibold">{roleLabel}</div>
          <div className="text-xs text-muted">
            {menuCount} menu item{menuCount === 1 ? "" : "s"} visible · {checked.size} permission
            {checked.size === 1 ? "" : "s"} granted
          </div>
        </div>
        <div className="ml-auto flex items-center gap-3">
          {canEdit ? (
            <>
              {dirty && <span className="text-xs text-ember">Unsaved changes</span>}
              <button type="submit" className="btn btn-primary" disabled={!dirty}>
                Save changes
              </button>
            </>
          ) : (
            <span className="text-xs text-muted">View only</span>
          )}
        </div>
      </div>

      {groups.map((g) => (
        <details key={g.id} open className="card overflow-hidden">
          <summary className="cursor-pointer select-none px-4 py-3 font-semibold border-b border-border/60">
            {g.label}
          </summary>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase tracking-wide text-muted">
                <tr className="border-b border-border/60">
                  <th className="text-left font-medium px-4 py-2">Resource</th>
                  <th className="font-medium px-2 py-2 w-14">View</th>
                  <th className="font-medium px-2 py-2 w-14">Edit</th>
                  <th className="font-medium px-2 py-2 w-14">Delete</th>
                  <th className="text-left font-medium px-4 py-2">Other actions</th>
                </tr>
              </thead>
              <tbody>
                {g.rows.map((r) => {
                  const lockOthers = !!r.view && !checked.has(r.view.key);
                  return (
                    <tr key={r.key} className="border-b border-border/40 last:border-0">
                      <td className="px-4 py-2">
                        <span className={r.isSection ? "text-muted" : "font-medium"}>
                          {r.isSection && <span className="text-muted/60">↳ </span>}
                          {r.label}
                        </span>
                      </td>
                      <td className="text-center px-2 py-2">{renderCell(r.view, true, false)}</td>
                      <td className="text-center px-2 py-2">{renderCell(r.edit, false, lockOthers)}</td>
                      <td className="text-center px-2 py-2">{renderCell(r.del, false, lockOthers)}</td>
                      <td className="px-4 py-2">
                        <div className="flex flex-wrap gap-x-4 gap-y-1">
                          {r.specials.length === 0 ? (
                            <span className="text-muted/40">—</span>
                          ) : (
                            r.specials.map((s) => (
                              <label
                                key={s.key}
                                title={s.key}
                                className={`inline-flex items-center gap-1.5 ${
                                  lockOthers ? "opacity-40" : "cursor-pointer"
                                } ${s.danger ? "text-danger" : ""}`}
                              >
                                <input
                                  type="checkbox"
                                  className={s.danger ? "accent-red-600" : ""}
                                  checked={checked.has(s.key)}
                                  disabled={lockOthers || !canEdit}
                                  onChange={() => toggle(s.key, false)}
                                />
                                <span className="text-xs">{s.label}</span>
                              </label>
                            ))
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </details>
      ))}
    </form>
  );
}
