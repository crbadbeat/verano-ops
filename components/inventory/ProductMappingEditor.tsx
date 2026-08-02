"use client";

import { useActionState } from "react";
import { updateProductMapping, type ActionState } from "@/app/inventory/actions";
import { productDisplayName } from "@/lib/item-master";

export type ProductMapping = {
  id: string;
  sku: string;
  displayName: string | null;
  name: string;
  description: string | null;
  category: string | null;
  netsuiteNumber: string | null;
  barcode: string | null;
  parentSku: string | null;
  buildCategory: "SPECIAL" | "PARENT" | "CHILD" | null;
  maxStockLevel: number | null;
  pickable: boolean;
  active: boolean;
};

const BUILD_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "— none —" },
  { value: "SPECIAL", label: "Special — built per order" },
  { value: "PARENT", label: "Parent — stocked" },
  { value: "CHILD", label: "Child — built from a parent" },
];

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5 break-words">
        {value ?? <span className="text-muted">—</span>}
      </dd>
    </div>
  );
}

/**
 * The product's mapping / identity panel. Managers get an inline edit form;
 * everyone else sees a read-only view. The SKU is shown but never editable — it
 * is the product's identity and the whole ledger history hangs off it.
 */
export default function ProductMappingEditor({
  product,
  canManage,
}: {
  product: ProductMapping;
  canManage: boolean;
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    updateProductMapping,
    {}
  );

  if (!canManage) {
    return (
      <div className="card p-4 space-y-3">
        <h2 className="font-semibold">Mapping</h2>
        <dl className="grid sm:grid-cols-2 gap-x-8 gap-y-3 text-sm">
          <Field label="SKU (identity)" value={<span className="font-mono text-xs">{product.sku}</span>} />
          <Field label="Display name" value={productDisplayName(product)} />
          <Field label="Display name override" value={product.displayName} />
          <Field
            label="NetSuite number"
            value={product.netsuiteNumber ? <span className="font-mono text-xs">{product.netsuiteNumber}</span> : null}
          />
          <Field label="NetSuite name" value={product.name} />
          <Field label="NetSuite description" value={product.description} />
          <Field label="Category" value={product.category} />
          <Field
            label="Barcode"
            value={product.barcode ? <span className="font-mono text-xs">{product.barcode}</span> : null}
          />
          <Field
            label="Built / cut from (parent)"
            value={product.parentSku ? <span className="font-mono text-xs">{product.parentSku}</span> : null}
          />
          <Field
            label="Build category"
            value={BUILD_OPTIONS.find((o) => o.value === (product.buildCategory ?? ""))?.label}
          />
          <Field label="Max stock level" value={product.maxStockLevel} />
          <Field label="Pickable" value={product.pickable ? "Yes — appears on pick lists" : "No — built into the base"} />
          <Field label="Active" value={product.active ? "Yes" : "No — archived"} />
        </dl>
      </div>
    );
  }

  return (
    <form action={formAction} className="card p-4 space-y-4">
      <input type="hidden" name="productId" value={product.id} />
      <div className="flex items-center gap-3">
        <h2 className="font-semibold">Mapping</h2>
        <span className="badge font-mono text-muted">{product.sku}</span>
        <span className="text-xs text-muted ml-auto">Editable — SKU is fixed identity</span>
      </div>

      <div className="grid sm:grid-cols-2 gap-4 text-sm">
        <label className="block sm:col-span-2">
          <span className="text-xs text-muted">Display name (override)</span>
          <input
            name="displayName"
            defaultValue={product.displayName ?? ""}
            className="input mt-1"
            placeholder="The name to show everywhere — leave blank to use the NetSuite name below"
          />
        </label>
        <label className="block">
          <span className="text-xs text-muted">NetSuite name *</span>
          <input name="name" defaultValue={product.name} required className="input mt-1" />
          <span className="text-[11px] text-muted mt-1 block">
            Kept current by the NetSuite sync; used only when there is no override.
          </span>
        </label>
        <label className="block">
          <span className="text-xs text-muted">NetSuite number</span>
          <input
            name="netsuiteNumber"
            defaultValue={product.netsuiteNumber ?? ""}
            className="input mt-1 font-mono"
            placeholder="stable NetSuite item number"
          />
        </label>
        <label className="block sm:col-span-2">
          <span className="text-xs text-muted">NetSuite description</span>
          <input name="description" defaultValue={product.description ?? ""} className="input mt-1" />
        </label>
        <label className="block">
          <span className="text-xs text-muted">Category</span>
          <input name="category" defaultValue={product.category ?? ""} className="input mt-1" />
        </label>
        <label className="block">
          <span className="text-xs text-muted">Barcode</span>
          <input name="barcode" defaultValue={product.barcode ?? ""} className="input mt-1 font-mono" />
        </label>
        <label className="block">
          <span className="text-xs text-muted">Built / cut from (parent SKU)</span>
          <input name="parentSku" defaultValue={product.parentSku ?? ""} className="input mt-1 font-mono" />
        </label>
        <label className="block">
          <span className="text-xs text-muted">Build category</span>
          <select name="buildCategory" defaultValue={product.buildCategory ?? ""} className="input mt-1">
            {BUILD_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-xs text-muted">Max stock level</span>
          <input
            name="maxStockLevel"
            type="number"
            min={0}
            defaultValue={product.maxStockLevel ?? ""}
            className="input mt-1"
          />
        </label>
        <div className="flex items-center gap-6 pt-1 sm:col-span-2">
          <label className="flex items-center gap-2">
            <input type="checkbox" name="pickable" defaultChecked={product.pickable} />
            <span>Pickable</span>
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" name="active" defaultChecked={product.active} />
            <span>Active</span>
          </label>
        </div>
      </div>

      {state.message && (
        <p className={`text-sm ${state.ok ? "text-success" : "text-danger"}`}>{state.message}</p>
      )}

      <button type="submit" className="btn btn-primary text-sm" disabled={pending}>
        {pending ? "Saving…" : "Save changes"}
      </button>
    </form>
  );
}
