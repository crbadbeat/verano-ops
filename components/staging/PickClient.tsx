"use client";

import { useActionState, useCallback, useEffect, useState } from "react";
import Scanner from "@/components/Scanner";
import { searchProducts, type ProductLite } from "@/app/count/actions";
import { recordPick, type PickState } from "@/app/staging/actions";

type Bucket = "BASE" | "GLASS" | "APPLIANCE" | "OTHER";

interface Selected {
  productId?: string;
  code: string; // SKU or barcode to submit as `scanned`
  name: string;
}

// A pick scan is either the source bin (its QR is a ?loc= URL) or an item (a
// Base/Glass SKU-QR is the raw SKU; other items are a barcode).
function routeScan(value: string): { kind: "loc" | "item"; code: string } {
  try {
    const u = new URL(value);
    const loc = u.searchParams.get("loc");
    if (loc) return { kind: "loc", code: loc.trim().toUpperCase() };
    const sku = u.searchParams.get("sku");
    if (sku) return { kind: "item", code: sku.trim() };
  } catch {
    /* not a URL — a bare SKU or barcode */
  }
  return { kind: "item", code: value.trim() };
}

export default function PickClient({
  tripId,
  category,
  primaryLaneCode,
}: {
  tripId: string;
  category: Bucket;
  primaryLaneCode: string | null;
}) {
  const [state, formAction, pending] = useActionState<PickState, FormData>(recordPick, {});

  const [binCode, setBinCode] = useState("");
  const [selected, setSelected] = useState<Selected | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ProductLite[]>([]);
  const [qty, setQty] = useState(1);
  const [scanMsg, setScanMsg] = useState<string | null>(null);

  // Type-ahead for the manual item picker (no-barcode items), scoped to the tab.
  useEffect(() => {
    const q = query.trim();
    if (!q) return;
    let active = true;
    const t = setTimeout(async () => {
      const r = await searchProducts(q, category === "OTHER" ? undefined : category);
      if (active) setResults(r);
    }, 250);
    return () => {
      active = false;
      clearTimeout(t);
    };
  }, [query, category]);

  // Reset the item row (keep the source bin) once a pick succeeds.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (state?.ok) {
      setSelected(null);
      setQuery("");
      setResults([]);
      setQty(1);
    }
  }, [state]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const handleDetected = useCallback((value: string) => {
    const p = routeScan(value);
    if (p.kind === "loc") {
      setBinCode(p.code);
      setScanMsg(`Source bin: ${p.code}`);
    } else {
      setSelected({ code: p.code, name: "(scanned)" });
      setScanMsg(`Item: ${p.code}`);
    }
  }, []);

  function pick(p: ProductLite) {
    setSelected({ productId: p.id, code: p.sku, name: p.name });
    setQuery("");
    setResults([]);
  }

  const noLane = !primaryLaneCode;
  const disabled = pending || noLane || !binCode.trim() || !selected;

  return (
    <div className="card p-4 space-y-4">
      <div className="flex items-center gap-2 flex-wrap text-sm">
        <span className="text-muted">Staging to</span>
        {primaryLaneCode ? (
          <span className="badge text-teal font-mono">{primaryLaneCode}</span>
        ) : (
          <span className="badge text-danger">no lane assigned</span>
        )}
      </div>

      {/* Source bin */}
      <label className="text-sm text-muted space-y-1 block">
        <span>Source bin (scan its label, or type the code)</span>
        <input
          className="input w-full font-mono"
          value={binCode}
          onChange={(e) => setBinCode(e.target.value.toUpperCase())}
          placeholder="e.g. 10-A-2"
        />
      </label>

      <Scanner onDetected={handleDetected} label="Scan bin or item" />
      {scanMsg && <p className="text-sm text-teal">{scanMsg}</p>}

      {/* Item */}
      {!selected ? (
        <div className="relative">
          <input
            className="input"
            placeholder="Scan the item, or search by SKU / name…"
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
            <div className="font-mono text-sm truncate">{selected.code}</div>
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

      <form action={formAction} className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="tripId" value={tripId} />
        <input type="hidden" name="locationCode" value={binCode} />
        {selected?.productId && <input type="hidden" name="productId" value={selected.productId} />}
        {selected && !selected.productId && (
          <input type="hidden" name="scanned" value={selected.code} />
        )}
        <label className="text-sm">
          <span className="text-muted">Quantity</span>
          <input
            name="qty"
            type="number"
            min={1}
            className="input w-24 mt-1"
            value={qty}
            onChange={(e) => setQty(Math.max(1, Number(e.target.value)))}
          />
        </label>
        <button className="btn btn-primary ml-auto" type="submit" disabled={disabled}>
          {pending ? "Picking…" : "Pick to lane"}
        </button>
      </form>

      {noLane && (
        <p className="text-sm text-muted">A manager needs to assign a lane before picking.</p>
      )}
      {state?.message && (
        <p className={`text-sm ${state.ok ? "text-success" : "text-danger"}`}>{state.message}</p>
      )}
    </div>
  );
}
