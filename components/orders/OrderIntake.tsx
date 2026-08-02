"use client";

import { useActionState, useState } from "react";
import type { OrderIntakeState } from "@/app/orders/actions";
import { tooLargeMessage } from "./upload-limit";

type Action = (
  prev: OrderIntakeState,
  formData: FormData
) => Promise<OrderIntakeState>;

const TABS = [
  {
    key: "pdf",
    label: "Upload agreement",
    blurb:
      "The best source: the signed Final Sales Agreement carries the customer, the money and every item that was sold.",
  },
  {
    key: "url",
    label: "Paste configurator link",
    blurb:
      "Decodes the saved 3D configuration. It has no customer or order number, so add those here.",
  },
  {
    key: "manual",
    label: "Build by hand",
    blurb: "Start an empty order and add islands and items yourself.",
  },
] as const;

function Result({ state }: { state: OrderIntakeState }) {
  if (!state?.message && !state?.warnings?.length) return null;
  return (
    <div className="mt-3 space-y-2">
      {state.message && (
        <p className={`text-sm ${state.ok ? "text-success" : "text-danger"}`}>
          {state.message}
        </p>
      )}
      {state.warnings && state.warnings.length > 0 && (
        <details className="text-sm text-muted">
          <summary className="cursor-pointer">
            {state.warnings.length} thing(s) to check
          </summary>
          <ul className="mt-2 list-disc pl-5 space-y-1">
            {state.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

export default function OrderIntake({
  fromPdf,
  fromUrl,
  manual,
}: {
  fromPdf: Action;
  fromUrl: Action;
  manual: Action;
}) {
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("pdf");
  const [sizeError, setSizeError] = useState<string | null>(null);
  const [pdfState, pdfAction, pdfPending] = useActionState<OrderIntakeState, FormData>(
    fromPdf,
    {}
  );
  const [urlState, urlAction, urlPending] = useActionState<OrderIntakeState, FormData>(
    fromUrl,
    {}
  );
  const [manState, manAction, manPending] = useActionState<OrderIntakeState, FormData>(
    manual,
    {}
  );

  const active = TABS.find((t) => t.key === tab)!;

  return (
    <div className="card p-5">
      <div className="flex flex-wrap gap-1" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={`px-3 py-1.5 rounded-lg text-sm ${
              tab === t.key ? "bg-surface-2 font-semibold" : "text-muted hover:bg-surface-2"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <p className="text-sm text-muted mt-3">{active.blurb}</p>

      {tab === "pdf" && (
        <form
          action={pdfAction}
          onSubmit={(e) => {
            const problem = tooLargeMessage(e.currentTarget);
            setSizeError(problem);
            if (problem) e.preventDefault();
          }}
          className="mt-4 space-y-3"
        >
          <input
            type="file"
            name="file"
            accept=".pdf"
            required
            onChange={() => setSizeError(null)}
            className="input file:mr-3 file:rounded-md file:border-0 file:bg-surface-2 file:px-3 file:py-1 file:text-foreground"
          />
          <label className="block text-xs text-muted">
            Order number — only needed if the agreement does not print one
            <input name="orderNo" placeholder="14454" className="input mt-1" />
          </label>
          <button className="btn btn-primary" type="submit" disabled={pdfPending}>
            {pdfPending ? "Reading the agreement…" : "Read agreement"}
          </button>
          {sizeError && <p className="text-sm text-danger">{sizeError}</p>}
          <Result state={pdfState} />
        </form>
      )}

      {tab === "url" && (
        <form action={urlAction} className="mt-4 space-y-3">
          <input
            name="url"
            required
            placeholder="https://veranodirect.com/configurator_1/?ISLAND=…"
            className="input"
          />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <input name="orderNo" required placeholder="Order # (e.g. 14454)" className="input" />
            <input name="customerFirst" placeholder="Customer first name" className="input" />
            <input name="customerLast" placeholder="Customer last name" className="input" />
          </div>
          <button className="btn btn-primary" type="submit" disabled={urlPending}>
            {urlPending ? "Decoding…" : "Decode link"}
          </button>
          <Result state={urlState} />
        </form>
      )}

      {tab === "manual" && (
        <form action={manAction} className="mt-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <input name="orderNo" required placeholder="Order # (e.g. 14454)" className="input" />
            <input name="customerFirst" placeholder="Customer first name" className="input" />
            <input name="customerLast" placeholder="Customer last name" className="input" />
          </div>
          <button className="btn btn-primary" type="submit" disabled={manPending}>
            {manPending ? "Creating…" : "Create empty order"}
          </button>
          <Result state={manState} />
        </form>
      )}
    </div>
  );
}
