"use client";

import { useActionState } from "react";
import { createEmployee, type ActionState } from "@/app/admin/employees/actions";

/** Minimal create form — identity only; org, divisions and login are set on the
 *  employee's page once they exist. */
export default function NewEmployeeForm() {
  const [state, action, pending] = useActionState<ActionState, FormData>(createEmployee, {});
  return (
    <form action={action} className="card p-5 space-y-4">
      <div className="grid sm:grid-cols-2 gap-3 text-sm">
        <label className="sm:col-span-2">
          <span className="text-muted">Full name *</span>
          <input name="name" required className="input mt-1" placeholder="Jane Q. Rep" />
        </label>
        <label>
          <span className="text-muted">First name</span>
          <input name="firstName" className="input mt-1" />
        </label>
        <label>
          <span className="text-muted">Last name</span>
          <input name="lastName" className="input mt-1" />
        </label>
        <label>
          <span className="text-muted">Job title</span>
          <input name="title" className="input mt-1" placeholder="Sales Rep" />
        </label>
        <label>
          <span className="text-muted">Email</span>
          <input name="email" type="email" className="input mt-1" />
        </label>
        <label>
          <span className="text-muted">Phone</span>
          <input name="phone" className="input mt-1" />
        </label>
        <label>
          <span className="text-muted">Cell</span>
          <input name="cell" className="input mt-1" />
        </label>
        <label>
          <span className="text-muted">Employee code</span>
          <input name="code" className="input mt-1 font-mono" />
        </label>
        <label>
          <span className="text-muted">ADP id</span>
          <input name="adpId" className="input mt-1 font-mono" />
        </label>
        <label>
          <span className="text-muted">Hire date</span>
          <input name="hireDate" type="date" className="input mt-1" />
        </label>
      </div>

      {state.message && !state.ok && <p className="text-sm text-danger">{state.message}</p>}

      <button className="btn btn-primary" disabled={pending}>
        {pending ? "Creating…" : "Create employee"}
      </button>
    </form>
  );
}
