"use client";

import { useActionState } from "react";
import { resolveManagersFromAdp, type ActionState } from "@/app/admin/employees/actions";

/** One-click: fill empty managerId from the ADP supervisor codes (deterministic). */
export default function ResolveManagersButton() {
  const [state, action, pending] = useActionState<ActionState, FormData>(resolveManagersFromAdp, {});
  return (
    <div className="flex items-center gap-3 flex-wrap">
      <form action={action}>
        <button className="btn btn-ghost text-sm" disabled={pending}>
          {pending ? "Resolving…" : "Resolve managers from ADP"}
        </button>
      </form>
      {state.message && (
        <span className={`text-sm ${state.ok ? "text-success" : "text-danger"}`}>{state.message}</span>
      )}
    </div>
  );
}
