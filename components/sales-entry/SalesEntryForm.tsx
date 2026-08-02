"use client";

import { useActionState, useMemo, useState, type ReactNode } from "react";
import type { ActionState } from "@/app/sales-entry/actions";
import type { ShowOption, EmployeeOption } from "@/lib/sales-entry-data";
import {
  DEAL_TYPES,
  SALE_TYPES,
  UPGRADE_SALE_TYPE,
  GRILL_ISLANDS,
  ISLAND_BARS,
  ADDITIONAL_ISLANDS,
  SHADES_OF_VERANO,
  ENABLE_GRILL_ISLAND,
  ENABLE_ISLAND_BAR,
  ENABLE_ADDITIONAL_ISLAND,
  ENABLE_SHADES,
} from "@/lib/sales-entry";

export interface SalesEntryInitial {
  id: string;
  showEventId: string | null;
  showLeaderId: string | null;
  salesRepId: string;
  isSplitDeal: boolean;
  secondSalesRepId: string | null;
  customerFirst: string;
  customerLast: string;
  dealType: string;
  saleType: string;
  priceList: string;
  grillIsland: string | null;
  islandBar: string | null;
  additionalIsland: string | null;
  shadesOfVerano: string | null;
  productTotalCents: number;
  pflFeeCents: number | null;
  soldAt: string | null; // yyyy-mm-dd
}

function dollars(cents: number | null | undefined): string {
  return cents == null ? "" : (cents / 100).toFixed(2);
}

function Select({
  name,
  label,
  required,
  value,
  onChange,
  disabled,
  options,
  placeholder = "Select",
  labelAside,
}: {
  name: string;
  label: string;
  required?: boolean;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  options: readonly string[] | { value: string; label: string }[];
  placeholder?: string;
  labelAside?: ReactNode;
}) {
  const opts = options.map((o) => (typeof o === "string" ? { value: o, label: o } : o));
  return (
    <label className="block">
      <span className="text-muted text-sm flex items-center justify-between gap-2">
        <span>
          {required && <span className="text-ember">* </span>}
          {label}
        </span>
        {labelAside}
      </span>
      <select
        name={name}
        required={required}
        disabled={disabled}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="input mt-1 disabled:opacity-50"
      >
        <option value="">{placeholder}</option>
        {opts.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export default function SalesEntryForm({
  shows,
  employees,
  priceLists,
  action,
  submitLabel,
  initial,
  canEditDate = false,
}: {
  shows: ShowOption[];
  employees: EmployeeOption[];
  priceLists: string[];
  action: (prev: ActionState, form: FormData) => Promise<ActionState>;
  submitLabel: string;
  initial?: SalesEntryInitial | null;
  /** Only a manager/admin correcting an entry may set the sale date. */
  canEditDate?: boolean;
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(action, {});

  const [showEventId, setShowEventId] = useState(initial?.showEventId ?? "");
  const [isSplitDeal, setIsSplitDeal] = useState(initial?.isSplitDeal ?? false);
  const [saleType, setSaleType] = useState(initial?.saleType ?? "");
  const [salesRepId, setSalesRepId] = useState(initial?.salesRepId ?? "");
  const [secondSalesRepId, setSecondSalesRepId] = useState(initial?.secondSalesRepId ?? "");
  const [dealType, setDealType] = useState(initial?.dealType ?? "");
  const [priceList, setPriceList] = useState(initial?.priceList ?? "");
  const [grillIsland, setGrillIsland] = useState(initial?.grillIsland ?? "");
  const [islandBar, setIslandBar] = useState(initial?.islandBar ?? "");
  const [additionalIsland, setAdditionalIsland] = useState(initial?.additionalIsland ?? "");
  const [shades, setShades] = useState(initial?.shadesOfVerano ?? "");
  // Rep pickers default to the selected show's own staff roster; "See all reps"
  // opens the picker to every PGI employee.
  const [showAllReps, setShowAllReps] = useState(false);

  const employeeOpts = employees.map((e) => ({
    value: e.id,
    label: e.code ? `${e.name} (${e.code})` : e.name,
  }));
  const showOpts = shows.map((s) => ({ value: s.id, label: s.name }));
  const selectedShow = shows.find((s) => s.id === showEventId) ?? null;
  // The show leader is read-only — it comes from the show's setup, not the rep.
  const showLeaderName = selectedShow?.leaderName ?? null;

  // The selected show's roster (assigned staff + leader), each carrying its own
  // label — so a roster member shows even when they're not in the global PGI list.
  const rosterOpts = useMemo(
    () =>
      selectedShow?.roster.map((e) => ({
        value: e.id,
        label: e.code ? `${e.name} (${e.code})` : e.name,
      })) ?? null,
    [selectedShow]
  );
  const canScope = rosterOpts != null && rosterOpts.length > 0;
  const scopeReps = canScope && !showAllReps;
  // Rep options for a picker: the roster when scoping (always keeping any already-
  // chosen off-roster rep selectable), otherwise every PGI employee.
  const repOptionsFor = (currentValue: string) => {
    if (!scopeReps) return employeeOpts;
    const opts = rosterOpts!;
    if (currentValue && !opts.some((o) => o.value === currentValue)) {
      const off = employeeOpts.find((o) => o.value === currentValue);
      return off ? [...opts, off] : opts;
    }
    return opts;
  };
  const repScopeToggle = canScope ? (
    <button
      type="button"
      onClick={() => setShowAllReps((v) => !v)}
      className="text-xs text-teal hover:underline font-normal"
    >
      {showAllReps ? "Show assigned" : "See all reps"}
    </button>
  ) : null;
  // Keep an already-saved price list selectable on edit even if since deactivated.
  const priceListOptions =
    priceList && !priceLists.includes(priceList) ? [...priceLists, priceList] : priceLists;

  // Deal Type "Upgrade/Add On" forces the Sale Type to the same value (Power App rule).
  const isUpgrade = dealType === UPGRADE_SALE_TYPE;
  const saleTypeOptions = isUpgrade ? [UPGRADE_SALE_TYPE] : SALE_TYPES;
  const grillEnabled = ENABLE_GRILL_ISLAND.includes(saleType);
  const barEnabled = ENABLE_ISLAND_BAR.includes(saleType);
  const additionalEnabled = ENABLE_ADDITIONAL_ISLAND.includes(saleType);
  const shadesEnabled = ENABLE_SHADES.includes(saleType);

  // Changing the sale type clears any island/shades field it no longer allows,
  // so an off-rule product can never ride along on a submit.
  function applySaleType(v: string) {
    setSaleType(v);
    if (!ENABLE_GRILL_ISLAND.includes(v)) setGrillIsland("");
    if (!ENABLE_ISLAND_BAR.includes(v)) setIslandBar("");
    if (!ENABLE_ADDITIONAL_ISLAND.includes(v)) setAdditionalIsland("");
    if (!ENABLE_SHADES.includes(v)) setShades("");
  }

  function onDealTypeChange(v: string) {
    setDealType(v);
    if (v === UPGRADE_SALE_TYPE) applySaleType(UPGRADE_SALE_TYPE);
    else if (saleType === UPGRADE_SALE_TYPE) applySaleType("");
  }

  return (
    <form action={formAction} className="space-y-6">
      {initial && <input type="hidden" name="id" value={initial.id} />}
      {/* isSplitDeal is a controlled checkbox; submit "on" when checked */}
      <input type="hidden" name="isSplitDeal" value={isSplitDeal ? "on" : ""} />

      <div className="flex items-center justify-end gap-2">
        <span className="text-sm text-muted">Split Deal?</span>
        <button
          type="button"
          role="switch"
          aria-checked={isSplitDeal}
          onClick={() => setIsSplitDeal((v) => !v)}
          className={`relative h-6 w-11 rounded-full transition-colors ${
            isSplitDeal ? "bg-ember" : "bg-surface-2"
          }`}
        >
          <span
            className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
              isSplitDeal ? "translate-x-5" : "translate-x-0.5"
            }`}
          />
        </button>
        <span className="text-sm font-medium">{isSplitDeal ? "Yes" : "No"}</span>
      </div>

      <div className="grid gap-x-6 gap-y-4 md:grid-cols-3">
        {/* Column 1 — show / rep / customer */}
        <Select
          name="showEventId"
          label="Show"
          required
          value={showEventId}
          onChange={setShowEventId}
          options={showOpts}
          placeholder="Select a show"
        />
        <Select
          name="salesRepId"
          label="Sales Rep"
          required
          value={salesRepId}
          onChange={setSalesRepId}
          options={repOptionsFor(salesRepId)}
          labelAside={repScopeToggle}
        />
        <Select
          name="dealType"
          label="Deal Type"
          required
          value={dealType}
          onChange={onDealTypeChange}
          options={DEAL_TYPES}
        />

        {/* Column 2 — leader (read-only from the show) / second rep / sale type */}
        <div className="block">
          <span className="text-muted text-sm">Show Leader</span>
          <div className="input mt-1 flex items-center bg-surface-2/40 text-muted cursor-not-allowed">
            {showLeaderName ?? "—"}
          </div>
          <p className="text-xs text-muted mt-1">Set on the show</p>
        </div>
        <Select
          name="secondSalesRepId"
          label="Second Sales Rep"
          value={secondSalesRepId}
          onChange={setSecondSalesRepId}
          options={repOptionsFor(secondSalesRepId)}
          disabled={!isSplitDeal}
          placeholder={isSplitDeal ? "Select" : "Split deal only"}
        />
        <Select
          name="saleType"
          label="Sale Type"
          required
          value={saleType}
          onChange={applySaleType}
          options={saleTypeOptions}
          disabled={isUpgrade}
        />

        {/* Money */}
        <label className="block">
          <span className="text-muted text-sm">
            <span className="text-ember">* </span>Product Total
          </span>
          <input
            name="productTotal"
            required
            type="number"
            min={0}
            step="0.01"
            inputMode="decimal"
            defaultValue={dollars(initial?.productTotalCents)}
            className="input mt-1"
            placeholder="0.00"
          />
        </label>
        <label className="block">
          <span className="text-muted text-sm">Verano for Life Membership Fee</span>
          <input
            name="pflFee"
            type="number"
            min={0}
            step="0.01"
            inputMode="decimal"
            defaultValue={dollars(initial?.pflFeeCents)}
            className="input mt-1"
            placeholder="0.00"
          />
        </label>
        <Select
          name="priceList"
          label="Price List"
          required
          value={priceList}
          onChange={setPriceList}
          options={priceListOptions}
        />

        {/* Islands / shades — enabled by sale type */}
        <Select
          name="grillIsland"
          label="Grill Island"
          value={grillIsland}
          onChange={setGrillIsland}
          options={GRILL_ISLANDS}
          disabled={!grillEnabled}
        />
        <Select
          name="islandBar"
          label="Island Bar"
          value={islandBar}
          onChange={setIslandBar}
          options={ISLAND_BARS}
          disabled={!barEnabled}
        />
        <Select
          name="additionalIsland"
          label="Additional Island"
          value={additionalIsland}
          onChange={setAdditionalIsland}
          options={ADDITIONAL_ISLANDS}
          disabled={!additionalEnabled}
        />
        <Select
          name="shadesOfVerano"
          label="Shades of Verano"
          value={shades}
          onChange={setShades}
          options={SHADES_OF_VERANO}
          disabled={!shadesEnabled}
        />

        {/* Customer */}
        <label className="block">
          <span className="text-muted text-sm">
            <span className="text-ember">* </span>Customer&apos;s First Name
          </span>
          <input
            name="customerFirst"
            required
            defaultValue={initial?.customerFirst ?? ""}
            className="input mt-1"
          />
        </label>
        <label className="block">
          <span className="text-muted text-sm">
            <span className="text-ember">* </span>Customer&apos;s Last Name
          </span>
          <input
            name="customerLast"
            required
            defaultValue={initial?.customerLast ?? ""}
            className="input mt-1"
          />
        </label>
        {canEditDate && (
          <label className="block">
            <span className="text-muted text-sm">Sale date</span>
            <input
              name="soldAt"
              type="date"
              defaultValue={initial?.soldAt ?? ""}
              className="input mt-1"
            />
            <p className="text-xs text-muted mt-1">Admin correction only</p>
          </label>
        )}
      </div>

      {state.message && !state.ok && <p className="text-sm text-danger">{state.message}</p>}

      <div className="flex items-center gap-3">
        <button className="btn btn-primary" disabled={pending}>
          {pending ? "Saving…" : submitLabel}
        </button>
        <span className="text-xs text-muted">
          <span className="text-ember">*</span> Required
        </span>
      </div>
    </form>
  );
}
