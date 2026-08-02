"use client";

import { useActionState } from "react";
import {
  createLoginForEmployee,
  resetEmployeePassword,
  type ActionState,
} from "@/app/admin/employees/actions";

type RoleOption = { value: string; label: string };

function TempPasswordNotice({ state }: { state: ActionState }) {
  if (!state.message) return null;
  return (
    <div className={`mt-3 text-sm ${state.ok ? "text-success" : "text-danger"}`}>
      <p>{state.message}</p>
      {state.tempPassword && (
        <p className="mt-2">
          Temporary password:{" "}
          <span className="font-mono text-base text-foreground bg-muted/20 px-2 py-0.5 rounded">
            {state.tempPassword}
          </span>
        </p>
      )}
    </div>
  );
}

/** Create-a-login form (for an employee with no login yet). */
export function CreateLoginForm({
  employeeId,
  defaultEmail,
  roles,
}: {
  employeeId: string;
  defaultEmail: string | null;
  roles: RoleOption[];
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(createLoginForEmployee, {});
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="employeeId" value={employeeId} />
      <p className="text-sm text-muted">
        No login yet. Create one with a temporary password you read out — the person changes it at
        first sign-in. A rep with no real inbox can use a plain handle (no “@”).
      </p>
      <div className="grid sm:grid-cols-2 gap-3">
        <label className="text-sm">
          <span className="text-muted">Login email or handle</span>
          <input
            name="loginEmail"
            defaultValue={defaultEmail ?? ""}
            placeholder="name@company.com or a handle"
            className="input mt-1"
          />
        </label>
        <label className="text-sm">
          <span className="text-muted">Role</span>
          <select name="role" defaultValue="SALES" className="input mt-1">
            {roles.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <button className="btn btn-primary text-sm" disabled={pending}>
        {pending ? "Creating…" : "Create login"}
      </button>
      <TempPasswordNotice state={state} />
    </form>
  );
}

/** Reset-password button (for an employee who already has a login). */
export function ResetLoginPassword({ employeeId }: { employeeId: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(resetEmployeePassword, {});
  return (
    <div>
      <form action={action}>
        <input type="hidden" name="employeeId" value={employeeId} />
        <button className="btn btn-ghost text-sm" disabled={pending}>
          {pending ? "Resetting…" : "Set a temporary password"}
        </button>
      </form>
      <TempPasswordNotice state={state} />
    </div>
  );
}
