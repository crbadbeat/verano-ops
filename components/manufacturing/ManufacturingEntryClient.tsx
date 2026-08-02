"use client";

import { useActionState, useCallback, useState } from "react";
import Scanner from "@/components/Scanner";
import { JOB_STAGES, STAGE_LABEL } from "@/lib/manufacturing";
import {
  recordJob,
  recordMod,
  type RecordState,
} from "@/app/manufacturing/actions";

export interface Opt {
  id: string;
  label: string;
}

function skuFromScan(value: string): string {
  try {
    const u = new URL(value);
    const s = u.searchParams.get("sku");
    if (s) return s.trim();
  } catch {
    /* not a URL */
  }
  return value.trim();
}

function StageSelect() {
  return (
    <select name="stage" required className="input" defaultValue="WELDING">
      {JOB_STAGES.map((s) => (
        <option key={s} value={s}>
          {STAGE_LABEL[s]}
        </option>
      ))}
    </select>
  );
}

function StyleSelect({ styles }: { styles: Opt[] }) {
  return (
    <select name="baseStyleId" className="input" defaultValue="">
      <option value="">Base style (for bonus)…</option>
      {styles.map((s) => (
        <option key={s.id} value={s.id}>
          {s.label}
        </option>
      ))}
    </select>
  );
}

function WorkerFields({ employees }: { employees: Opt[] }) {
  const [split, setSplit] = useState(false);
  return (
    <div className="space-y-2">
      <select name="employee1Id" required className="input" defaultValue="">
        <option value="" disabled>
          Worker…
        </option>
        {employees.map((e) => (
          <option key={e.id} value={e.id}>
            {e.label}
          </option>
        ))}
      </select>
      <label className="flex items-center gap-2 text-sm text-muted">
        <input
          type="checkbox"
          name="split"
          value="true"
          checked={split}
          onChange={(e) => setSplit(e.target.checked)}
        />
        Split job (bonus divided 50/50)
      </label>
      {split && (
        <select name="employee2Id" required className="input" defaultValue="">
          <option value="" disabled>
            Second worker…
          </option>
          {employees.map((e) => (
            <option key={e.id} value={e.id}>
              {e.label}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

function Feedback({ state }: { state: RecordState }) {
  if (!state?.message) return null;
  return (
    <p className={`text-sm ${state.ok ? "text-success" : "text-danger"}`}>
      {state.message}
    </p>
  );
}

export default function ManufacturingEntryClient({
  employees,
  styles,
  reasons,
}: {
  employees: Opt[];
  styles: Opt[];
  reasons: Opt[];
}) {
  const [tab, setTab] = useState<"JOB" | "MOD">("JOB");

  const [jobState, jobAction, jobPending] = useActionState<RecordState, FormData>(
    recordJob,
    {}
  );
  const [modState, modAction, modPending] = useActionState<RecordState, FormData>(
    recordMod,
    {}
  );

  const [sku, setSku] = useState("");
  const [changeConfig, setChangeConfig] = useState(false);

  const handleScan = useCallback((value: string) => setSku(skuFromScan(value)), []);

  if (employees.length === 0 || styles.length === 0) {
    return (
      <div className="card p-6 text-sm text-muted">
        Add at least one worker and one base style in{" "}
        <a href="/manufacturing/setup" className="text-ember underline">
          setup
        </a>{" "}
        before recording jobs.
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex gap-1 rounded-xl bg-surface-2 p-1">
        {(["JOB", "MOD"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`flex-1 rounded-lg py-2 text-sm font-medium transition ${
              tab === t ? "bg-ember text-[#1a1206]" : "text-muted hover:text-foreground"
            }`}
          >
            {t === "JOB" ? "Job" : "Mod"}
          </button>
        ))}
      </div>

      {tab === "JOB" ? (
        <form action={jobAction} className="space-y-3">
          <Scanner onDetected={handleScan} label="Scan base SKU" />
          <input
            name="productSku"
            value={sku}
            onChange={(e) => setSku(e.target.value)}
            required
            placeholder="Base SKU (scan or type)"
            className="input font-mono"
          />
          <StageSelect />
          <StyleSelect styles={styles} />
          <WorkerFields employees={employees} />
          <input name="note" placeholder="Note (optional)" className="input" />
          <button className="btn btn-primary w-full" type="submit" disabled={jobPending}>
            {jobPending ? "Recording…" : "Record job"}
          </button>
          <Feedback state={jobState} />
          <p className="text-xs text-muted">
            Wrapping also adds the finished base to stock (and consumes its BOM).
          </p>
        </form>
      ) : (
        <form action={modAction} className="space-y-3">
          <StageSelect />
          <StyleSelect styles={styles} />
          <WorkerFields employees={employees} />
          <select name="modReasonId" className="input" defaultValue="">
            <option value="">Mod reason…</option>
            {reasons.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-2 text-sm text-muted">
            <input
              type="checkbox"
              name="changeConfig"
              value="true"
              checked={changeConfig}
              onChange={(e) => setChangeConfig(e.target.checked)}
            />
            Configuration changed (swap inventory)
          </label>
          {changeConfig && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <input
                name="originalSku"
                placeholder="Original SKU (−1)"
                className="input font-mono"
              />
              <input
                name="newSku"
                placeholder="New SKU (+1)"
                className="input font-mono"
              />
            </div>
          )}
          <input name="note" placeholder="Note (optional)" className="input" />
          <button className="btn btn-primary w-full" type="submit" disabled={modPending}>
            {modPending ? "Recording…" : "Record mod"}
          </button>
          <Feedback state={modState} />
        </form>
      )}
    </div>
  );
}
