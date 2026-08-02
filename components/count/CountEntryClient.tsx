"use client";

import { useActionState, useCallback, useEffect, useState } from "react";
import Scanner from "@/components/Scanner";
import {
  addCountEntry,
  deleteCountEntry,
  searchProducts,
  type EntryState,
  type ProductLite,
} from "@/app/count/actions";

type Category = "BASE" | "GLASS" | "APPLIANCE";

export interface Bin {
  id: string;
  code: string;
  name: string;
}

export type Condition = "NEW" | "SHOW_GOOD";

export interface EntryRow {
  id: string;
  qty: number;
  method: string;
  condition: Condition;
  crateCount: number | null;
  productSku: string | null;
  productName: string | null;
  rawSku: string | null;
  locationId: string | null;
  locationCode: string | null;
}

interface Selected {
  id?: string;
  sku: string;
  name: string;
  crateSize: number | null;
}

// Sentinel for "count this at warehouse level, no bin" — lets bin-less sites
// (showrooms, AZ) count Glass/Appliances the same way bases are counted.
const WAREHOUSE_LEVEL = "__WH__";

const CATEGORIES: { key: Category; label: string }[] = [
  { key: "BASE", label: "Bases" },
  { key: "GLASS", label: "Glass" },
  { key: "APPLIANCE", label: "Appliances / Raw" },
];

// Decide whether a scanned value is a location or an item, and extract its code.
function parseScan(
  value: string,
  bins: Bin[]
): { kind: "loc"; code: string } | { kind: "item"; sku: string } {
  let loc: string | null = null;
  let sku: string | null = null;
  try {
    const u = new URL(value);
    loc = u.searchParams.get("loc");
    sku = u.searchParams.get("sku");
  } catch {
    /* not a URL — fall through to bare-value handling */
  }
  if (loc) return { kind: "loc", code: loc.trim().toUpperCase() };
  if (sku) return { kind: "item", sku: sku.trim() };

  const bare = value.trim();
  const upper = bare.toUpperCase();
  if (bins.some((b) => b.code === upper)) return { kind: "loc", code: upper };
  return { kind: "item", sku: bare };
}

export default function CountEntryClient({
  sessionId,
  bins,
  entries,
  warehouseLevelLocationId,
}: {
  sessionId: string;
  bins: Bin[];
  entries: EntryRow[];
  /**
   * What "warehouse level" means for THIS session's warehouse: null for the
   * default (Ocoee) warehouse — matching the legacy null-location convention —
   * or the warehouse's own location id for a showroom / AZ.
   */
  warehouseLevelLocationId: string | null;
}) {
  const [state, formAction, pending] = useActionState<EntryState, FormData>(
    addCountEntry,
    {}
  );

  const [category, setCategory] = useState<Category>("BASE");
  // A site with no bins (showroom / AZ) counts everything at warehouse level.
  const [activeLocationId, setActiveLocationId] = useState<string | null>(() =>
    bins.length === 0 ? WAREHOUSE_LEVEL : null
  );
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ProductLite[]>([]);
  const [selected, setSelected] = useState<Selected | null>(null);
  const [entryMethod, setEntryMethod] = useState<"SCAN" | "MANUAL">("MANUAL");
  const [qty, setQty] = useState(1);
  const [crateOn, setCrateOn] = useState(false);
  const [crateCount, setCrateCount] = useState(1);
  const [scanMsg, setScanMsg] = useState<string | null>(null);
  // Show goods sit in the same bins as new stock, so this is a mode the counter
  // stays in while they work through what's in front of them — it deliberately
  // does NOT reset after each entry.
  const [condition, setCondition] = useState<Condition>("NEW");
  const showGood = condition === "SHOW_GOOD";

  const needsLocation = category !== "BASE";
  const activeLocation = bins.find((b) => b.id === activeLocationId) ?? null;

  // Type-ahead product search (debounced), scoped to the active category.
  useEffect(() => {
    const q = query.trim();
    if (!q) return; // dropdown is gated on `query` in render, so nothing to clear
    let active = true;
    const t = setTimeout(async () => {
      const r = await searchProducts(q, category);
      if (active) setResults(r);
    }, 250);
    return () => {
      active = false;
      clearTimeout(t);
    };
  }, [query, category]);

  // Reset the item row once the add server-action resolves successfully (keep
  // category + active location). This legitimately syncs local form state to an
  // async action result, so the set-state-in-effect rule is disabled here.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (state?.ok) {
      setSelected(null);
      setQuery("");
      setResults([]);
      setQty(1);
      setCrateOn(false);
      setCrateCount(1);
      setEntryMethod("MANUAL");
    }
  }, [state]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const handleDetected = useCallback(
    (value: string) => {
      const p = parseScan(value, bins);
      if (p.kind === "loc") {
        if (category === "BASE") {
          setScanMsg("Bases are counted at warehouse level — no location needed.");
          return;
        }
        const bin = bins.find((b) => b.code === p.code);
        if (bin) {
          setActiveLocationId(bin.id);
          setScanMsg(`Location set: ${bin.code}`);
        } else {
          setScanMsg(`Unknown location "${p.code}".`);
        }
      } else {
        setSelected({ sku: p.sku, name: "(scanned)", crateSize: null });
        setEntryMethod("SCAN");
        setScanMsg(`Item: ${p.sku}`);
      }
    },
    [bins, category]
  );

  function pick(p: ProductLite) {
    setSelected({ id: p.id, sku: p.sku, name: p.name, crateSize: p.crateSize });
    setEntryMethod("MANUAL");
    setQuery("");
    setResults([]);
  }

  function submit() {
    if (!selected) return;
    if (needsLocation && !activeLocationId) return;
    const fd = new FormData();
    fd.set("sessionId", sessionId);
    // A specific bin, else this warehouse's "warehouse level" slot ("" = null).
    const loc =
      needsLocation && activeLocationId && activeLocationId !== WAREHOUSE_LEVEL
        ? activeLocationId
        : warehouseLevelLocationId ?? "";
    fd.set("locationId", loc);
    fd.set("condition", condition);
    if (selected.id) fd.set("productId", selected.id);
    fd.set("sku", selected.sku);
    if (crateOn && category === "GLASS") {
      fd.set("crateCount", String(crateCount));
      fd.set("method", "CRATE");
    } else {
      fd.set("qty", String(qty));
      fd.set("method", entryMethod);
    }
    formAction(fd);
  }

  const addDisabled =
    pending || !selected || (needsLocation && !activeLocationId);

  // Group entries for display (warehouse level first, then bins).
  const groups = groupEntries(entries);

  return (
    <div
      className={
        showGood
          ? "space-y-6 rounded-2xl p-3 -mx-1 ring-2 ring-showgood bg-showgood/5"
          : "space-y-6"
      }
    >
      {/* Stock condition. A miscount here is invisible later — a show good
          recorded as new inflates sellable stock and deletes itself from the
          show-good balance — so the mode is stated loudly rather than implied. */}
      <div>
        <div className="flex gap-1 rounded-xl bg-surface-2 p-1 w-full">
          <button
            type="button"
            onClick={() => setCondition("NEW")}
            aria-pressed={!showGood}
            className={`flex-1 rounded-lg py-2 text-sm font-semibold transition ${
              !showGood
                ? "bg-foreground text-[#0b1120]"
                : "text-muted hover:text-foreground"
            }`}
          >
            New stock
          </button>
          <button
            type="button"
            onClick={() => setCondition("SHOW_GOOD")}
            aria-pressed={showGood}
            className={`flex-1 rounded-lg py-2 text-sm font-semibold transition ${
              showGood
                ? "bg-showgood text-[#160b2e]"
                : "text-muted hover:text-foreground"
            }`}
          >
            Show good
          </button>
        </div>
        {showGood && (
          <div
            role="status"
            className="mt-2 rounded-xl bg-showgood text-[#160b2e] px-4 py-3 flex items-center gap-3"
          >
            <span className="text-2xl leading-none" aria-hidden="true">
              ⬤
            </span>
            <div className="min-w-0">
              <div className="font-bold tracking-tight">
                COUNTING SHOW GOODS
              </div>
              <div className="text-sm opacity-80">
                Open-box stock back from a show. Everything you add is recorded as
                show good until you switch back.
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Category selector */}
      <div className="flex gap-1 rounded-xl bg-surface-2 p-1 w-full">
        {CATEGORIES.map((c) => (
          <button
            key={c.key}
            type="button"
            onClick={() => {
              setCategory(c.key);
              setScanMsg(null);
            }}
            className={`flex-1 rounded-lg py-2 text-sm font-medium transition ${
              category === c.key ? "bg-ember text-[#1a1206]" : "text-muted hover:text-foreground"
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>

      {/* Active location (glass / appliances) */}
      {needsLocation && (
        <div className="card p-4">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm text-muted">Location:</span>
            {activeLocation ? (
              <span className="badge font-mono text-teal">{activeLocation.code}</span>
            ) : activeLocationId === WAREHOUSE_LEVEL ? (
              <span className="badge text-teal">warehouse level</span>
            ) : (
              <span className="badge text-danger">none — scan or pick a bin</span>
            )}
            <select
              className="input ml-auto max-w-[240px] py-1"
              value={activeLocationId ?? ""}
              onChange={(e) => setActiveLocationId(e.target.value || null)}
            >
              <option value="">Select bin…</option>
              <option value={WAREHOUSE_LEVEL}>Warehouse level (no bin)</option>
              {bins.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.code} — {b.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      {/* Scanner (routes to location or item automatically) */}
      <div>
        <Scanner onDetected={handleDetected} label="Scan location or item" />
        {scanMsg && <p className="mt-2 text-sm text-teal">{scanMsg}</p>}
      </div>

      {/* Item entry */}
      <div className="card p-4 space-y-3">
        {!selected ? (
          <div className="relative">
            <input
              className="input"
              placeholder={`Search ${category === "BASE" ? "base config" : category === "GLASS" ? "glass top" : "item"} by SKU or name…`}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {query.trim() !== "" && results.length > 0 && (
              <ul className="absolute z-10 mt-1 w-full max-h-64 overflow-auto rounded-lg border border-border bg-surface-2 shadow-xl">
                {results.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => pick(p)}
                      className="block w-full text-left px-3 py-2 hover:bg-border/60"
                    >
                      <span className="font-mono text-xs">{p.sku}</span>
                      <span className="text-muted"> — {p.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <div className="min-w-0">
              <div className="font-mono text-sm truncate">{selected.sku}</div>
              <div className="text-xs text-muted truncate">{selected.name}</div>
            </div>
            <button
              type="button"
              className="btn btn-ghost py-1 px-2 text-xs ml-auto"
              onClick={() => setSelected(null)}
            >
              Change
            </button>
          </div>
        )}

        {selected && (
          <div className="flex flex-wrap items-end gap-3">
            {crateOn && category === "GLASS" ? (
              <label className="text-sm">
                <span className="text-muted">Crates</span>
                <input
                  type="number"
                  min={1}
                  className="input w-24 mt-1"
                  value={crateCount}
                  onChange={(e) => setCrateCount(Math.max(1, Number(e.target.value)))}
                />
              </label>
            ) : (
              <label className="text-sm">
                <span className="text-muted">Quantity</span>
                <input
                  type="number"
                  min={1}
                  className="input w-24 mt-1"
                  value={qty}
                  onChange={(e) => setQty(Math.max(1, Number(e.target.value)))}
                />
              </label>
            )}

            {category === "GLASS" && (
              <label className="flex items-center gap-2 text-sm text-muted pb-2">
                <input
                  type="checkbox"
                  checked={crateOn}
                  onChange={(e) => setCrateOn(e.target.checked)}
                />
                Crate{selected.crateSize ? ` (× ${selected.crateSize})` : ""}
              </label>
            )}

            <button
              type="button"
              className={`btn ml-auto ${
                showGood
                  ? "bg-showgood text-[#160b2e] hover:bg-showgood-strong hover:text-white"
                  : "btn-primary"
              }`}
              onClick={submit}
              disabled={addDisabled}
            >
              {pending
                ? "Adding…"
                : showGood
                  ? "Add show good"
                  : "Add count"}
            </button>
          </div>
        )}

        {state?.message && (
          <p className={`text-sm ${state.ok ? "text-success" : "text-danger"}`}>
            {state.message}
          </p>
        )}
      </div>

      {/* Counted so far (blind: no system on-hand shown) */}
      <div className="card overflow-hidden">
        <div className="p-4 border-b border-border flex items-center gap-3">
          <h3 className="font-semibold">Counted so far</h3>
          <span className="badge">{entries.length} entries</span>
        </div>
        {entries.length === 0 ? (
          <div className="p-8 text-center text-muted text-sm">
            Nothing counted yet.
          </div>
        ) : (
          <div className="divide-y divide-border/60">
            {groups.map((g) => (
              <div key={g.key} className="p-3">
                <div className="text-xs uppercase tracking-wide text-muted mb-1">
                  {g.label}
                </div>
                <ul className="space-y-1">
                  {g.rows.map((e) => (
                    <li key={e.id} className="flex items-center gap-2 text-sm">
                      <span className="font-mono text-xs truncate">
                        {e.productSku ?? e.rawSku ?? "—"}
                        {!e.productSku && (
                          <span className="text-danger"> (unmatched)</span>
                        )}
                      </span>
                      <span className="text-muted truncate">
                        {e.productName ?? ""}
                      </span>
                      {e.condition === "SHOW_GOOD" && (
                        <span className="badge text-showgood shrink-0">SG</span>
                      )}
                      <span className="ml-auto font-semibold tabular-nums">
                        {e.qty}
                        {e.crateCount ? (
                          <span className="text-muted font-normal">
                            {" "}
                            ({e.crateCount} cr)
                          </span>
                        ) : null}
                      </span>
                      <form action={deleteCountEntry}>
                        <input type="hidden" name="entryId" value={e.id} />
                        <button
                          type="submit"
                          className="text-muted hover:text-danger text-xs px-1"
                          aria-label="Remove entry"
                        >
                          ✕
                        </button>
                      </form>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function groupEntries(entries: EntryRow[]) {
  const map = new Map<string, { key: string; label: string; rows: EntryRow[] }>();
  for (const e of entries) {
    const key = e.locationCode ?? "_wh";
    const label = e.locationCode ?? "Warehouse level (bases)";
    const g = map.get(key) ?? { key, label, rows: [] };
    g.rows.push(e);
    map.set(key, g);
  }
  // warehouse level first, then bins alphabetically
  return [...map.values()].sort((a, b) =>
    a.key === "_wh" ? -1 : b.key === "_wh" ? 1 : a.label.localeCompare(b.label)
  );
}
