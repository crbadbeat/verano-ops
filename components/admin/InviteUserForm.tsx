"use client";

import { useActionState } from "react";
import { inviteUser, type InviteState } from "@/app/admin/users/actions";
import InviteLink from "./InviteLink";

type Warehouse = { id: string; code: string; name: string };
type Role = { value: string; label: string };

export default function InviteUserForm({
  roles,
  warehouses,
}: {
  roles: Role[];
  warehouses: Warehouse[];
}) {
  const [state, formAction, pending] = useActionState<InviteState, FormData>(
    inviteUser,
    {}
  );

  return (
    <div className="card p-5 space-y-4">
      <div>
        <h2 className="font-semibold">Invite a user</h2>
        <p className="text-sm text-muted mt-1">
          Create the account and choose the role — you never set a password. Send
          them the link that appears here and they set their own on first sign-in.
        </p>
      </div>

      <form action={formAction} className="grid sm:grid-cols-2 gap-3">
        <label className="text-sm">
          <span className="text-muted">Email</span>
          <input
            name="email"
            type="email"
            required
            placeholder="name@veranooutdoor.com"
            className="input mt-1"
          />
        </label>
        <label className="text-sm">
          <span className="text-muted">Name (optional)</span>
          <input name="name" className="input mt-1" placeholder="Full name" />
        </label>
        <label className="text-sm">
          <span className="text-muted">Role</span>
          <select name="role" defaultValue="STAFF" className="input mt-1">
            {roles.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="text-muted">Home warehouse</span>
          <select name="homeWarehouseId" defaultValue="" className="input mt-1">
            <option value="">Default (Ocoee)</option>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name} ({w.code})
              </option>
            ))}
          </select>
        </label>
        <div className="sm:col-span-2">
          <button className="btn btn-primary" type="submit" disabled={pending}>
            {pending ? "Creating…" : "Create invite"}
          </button>
        </div>
      </form>

      {state?.message && (
        <p className={`text-sm ${state.ok ? "text-success" : "text-danger"}`}>
          {state.message}
        </p>
      )}
      {state?.inviteUrl && <InviteLink url={state.inviteUrl} />}
    </div>
  );
}
