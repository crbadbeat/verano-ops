"use client";

import { useActionState } from "react";
import { reissueInvite, type InviteState } from "@/app/admin/users/actions";
import InviteLink from "./InviteLink";

/**
 * Per-user "reset password" control. Reissues a one-time invite link (and
 * invalidates the old password), revealing the fresh link inline.
 */
export default function ResetPasswordButton({ userId }: { userId: string }) {
  const [state, formAction, pending] = useActionState<InviteState, FormData>(
    reissueInvite,
    {}
  );

  return (
    <div className="space-y-2">
      <form action={formAction}>
        <input type="hidden" name="userId" value={userId} />
        <button
          type="submit"
          disabled={pending}
          className="btn btn-ghost py-1 px-2 text-xs"
        >
          {pending ? "Resetting…" : "Reset password"}
        </button>
      </form>
      {state?.message && (
        <p className={`text-xs ${state.ok ? "text-success" : "text-danger"}`}>
          {state.message}
        </p>
      )}
      {state?.inviteUrl && <InviteLink url={state.inviteUrl} />}
    </div>
  );
}
