"use client";

import { useActionState } from "react";
import type { UploadState } from "@/lib/upload";

export default function Uploader({
  action,
  title,
  hint,
  cta,
  hidden,
}: {
  action: (prev: UploadState, formData: FormData) => Promise<UploadState>;
  title: string;
  hint: string;
  cta: string;
  hidden?: Record<string, string>;
}) {
  const [state, formAction, pending] = useActionState<UploadState, FormData>(
    action,
    {}
  );

  return (
    <div className="card p-5">
      <h3 className="font-semibold">{title}</h3>
      <p className="text-sm text-muted mt-1">{hint}</p>
      <form action={formAction} className="mt-4 flex flex-col sm:flex-row gap-3">
        {hidden &&
          Object.entries(hidden).map(([k, v]) => (
            <input key={k} type="hidden" name={k} value={v} />
          ))}
        <input
          type="file"
          name="file"
          accept=".csv,.xlsx,.xlsm,.txt"
          required
          className="input file:mr-3 file:rounded-md file:border-0 file:bg-surface-2 file:px-3 file:py-1 file:text-foreground"
        />
        <button className="btn btn-primary whitespace-nowrap" type="submit" disabled={pending}>
          {pending ? "Uploading…" : cta}
        </button>
      </form>

      {state?.message && (
        <p className={`mt-3 text-sm ${state.ok ? "text-success" : "text-danger"}`}>
          {state.message}
        </p>
      )}
      {state?.errors && state.errors.length > 0 && (
        <details className="mt-2 text-sm text-muted">
          <summary className="cursor-pointer">
            {state.errors.length} row issue(s)
          </summary>
          <ul className="mt-2 list-disc pl-5 space-y-1">
            {state.errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
