"use client";

import { useActionState } from "react";
import { setPassword, type SetPasswordState } from "@/app/invite/actions";

export default function SetPasswordForm({ token }: { token: string }) {
  const [state, formAction, pending] = useActionState<SetPasswordState, FormData>(
    setPassword,
    {}
  );

  return (
    <form action={formAction} className="mt-6 space-y-4">
      <input type="hidden" name="token" value={token} />
      <div>
        <label className="text-sm text-muted" htmlFor="password">
          New password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          className="input mt-1"
          placeholder="At least 8 characters"
        />
      </div>
      <div>
        <label className="text-sm text-muted" htmlFor="confirm">
          Confirm password
        </label>
        <input
          id="confirm"
          name="confirm"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          className="input mt-1"
          placeholder="Re-enter password"
        />
      </div>

      {state?.error && <p className="text-danger text-sm">{state.error}</p>}

      <button className="btn btn-primary w-full" type="submit" disabled={pending}>
        {pending ? "Setting password…" : "Set password & sign in"}
      </button>
    </form>
  );
}
