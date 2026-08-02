"use client";

import { useActionState } from "react";
import Link from "next/link";
import { changePassword, type ChangePasswordState } from "@/app/login/actions";

/** Change-your-own-password form. Also serves the forced first-login reset. */
export default function ChangePasswordForm() {
  const [state, formAction, pending] = useActionState<ChangePasswordState, FormData>(
    changePassword,
    {}
  );

  if (state?.ok) {
    return (
      <div className="space-y-4 text-sm">
        <p className="text-success">Password updated.</p>
        <Link href="/" className="btn btn-primary">
          Continue
        </Link>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      <div>
        <label className="text-sm text-muted" htmlFor="currentPassword">
          Current password
        </label>
        <input
          id="currentPassword"
          name="currentPassword"
          type="password"
          autoComplete="current-password"
          required
          className="input mt-1"
          placeholder="••••••••"
        />
      </div>
      <div>
        <label className="text-sm text-muted" htmlFor="newPassword">
          New password
        </label>
        <input
          id="newPassword"
          name="newPassword"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          className="input mt-1"
          placeholder="At least 8 characters"
        />
      </div>
      <div>
        <label className="text-sm text-muted" htmlFor="confirmPassword">
          Confirm new password
        </label>
        <input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          className="input mt-1"
          placeholder="••••••••"
        />
      </div>

      {state?.error && <p className="text-danger text-sm">{state.error}</p>}

      <button className="btn btn-primary w-full" type="submit" disabled={pending}>
        {pending ? "Saving…" : "Update password"}
      </button>
    </form>
  );
}
