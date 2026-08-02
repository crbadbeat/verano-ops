"use client";

import { useActionState } from "react";
import { resetHubData, type ResetState } from "@/app/admin/actions";

export default function ResetForm() {
  const [state, action, pending] = useActionState<ResetState, FormData>(resetHubData, {});

  return (
    <form action={action} className="space-y-3">
      <input
        name="confirm"
        required
        autoComplete="off"
        placeholder="Type RESET to confirm"
        className="input font-mono"
      />
      <button
        className="btn w-full bg-danger text-white hover:opacity-90"
        type="submit"
        disabled={pending}
      >
        {pending ? "Resetting…" : "Wipe products + all transactional data"}
      </button>
      {state?.message && (
        <p className={`text-sm ${state.ok ? "text-success" : "text-danger"}`}>{state.message}</p>
      )}
    </form>
  );
}
