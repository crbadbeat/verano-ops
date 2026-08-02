"use client";

import { useActionState, useState } from "react";
import { login, register, type AuthState } from "@/app/login/actions";

/**
 * Sign-in form. `canRegister` is true only before the first account exists — the
 * one-time bootstrap that creates the initial admin. After that, registration is
 * closed and accounts are created by an admin via an invite link, so the toggle
 * is hidden and only sign-in is offered.
 */
export default function LoginForm({ canRegister }: { canRegister: boolean }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const active = canRegister ? mode : "login";
  const action = active === "login" ? login : register;
  const [state, formAction, pending] = useActionState<AuthState, FormData>(
    action,
    undefined
  );

  return (
    <div className="mx-auto max-w-md px-4 py-16">
      <div className="card p-8">
        <h1 className="text-2xl font-bold">
          {active === "login" ? "Welcome back" : "Create the first account"}
        </h1>
        <p className="text-muted text-sm mt-1">
          {active === "login"
            ? "Sign in to manage inventory and ship trips."
            : "This first account becomes the administrator."}
        </p>

        <form action={formAction} className="mt-6 space-y-4">
          <div>
            <label className="text-sm text-muted" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              className="input mt-1"
              placeholder="you@veranooutdoor.com"
            />
          </div>
          <div>
            <label className="text-sm text-muted" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete={active === "login" ? "current-password" : "new-password"}
              required
              minLength={8}
              className="input mt-1"
              placeholder="••••••••"
            />
          </div>

          {state?.error && <p className="text-danger text-sm">{state.error}</p>}

          <button className="btn btn-primary w-full" type="submit" disabled={pending}>
            {pending
              ? "Please wait…"
              : active === "login"
                ? "Sign in"
                : "Create account"}
          </button>
        </form>

        {canRegister && (
          <button
            type="button"
            onClick={() => setMode(mode === "login" ? "register" : "login")}
            className="mt-5 text-sm text-teal hover:underline"
          >
            {mode === "login"
              ? "First time here? Create the admin account"
              : "Already have an account? Sign in"}
          </button>
        )}
      </div>
    </div>
  );
}
