"use client";

import { useActionState } from "react";
import { login, signInWithGoogle, type LoginState } from "@/app/actions/auth";

export function LoginForm({ googleError }: { googleError?: boolean }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(login, undefined);

  return (
    <>
      <form action={action} className="mt-8 space-y-4">
        <div>
          <label htmlFor="email" className="block text-sm font-medium text-ink-100">
            E-mail
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            className="mt-1 w-full rounded-md border border-ink-700 bg-ink-950 px-3 py-2 text-ink-50 placeholder:text-ink-500 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
          />
          {state?.errors?.email && (
            <p className="mt-1 text-xs text-status-overdue">{state.errors.email[0]}</p>
          )}
        </div>

        <div>
          <label htmlFor="password" className="block text-sm font-medium text-ink-100">
            Senha
          </label>
          <input
            id="password"
            name="password"
            type="password"
            required
            className="mt-1 w-full rounded-md border border-ink-700 bg-ink-950 px-3 py-2 text-ink-50 placeholder:text-ink-500 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
          />
          {state?.errors?.password && (
            <p className="mt-1 text-xs text-status-overdue">{state.errors.password[0]}</p>
          )}
        </div>

        {state?.message && <p className="text-sm text-status-overdue">{state.message}</p>}

        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-md bg-gradient-to-b from-amber-300 to-amber-500 px-4 py-2 font-semibold text-ink-950 glow-amber transition hover:brightness-105 disabled:opacity-60"
        >
          {pending ? "Entrando..." : "Entrar"}
        </button>
      </form>

      <div className="my-5 flex items-center gap-3">
        <div className="h-px flex-1 bg-ink-700" />
        <span className="text-xs uppercase tracking-wide text-ink-500">ou</span>
        <div className="h-px flex-1 bg-ink-700" />
      </div>

      <form action={signInWithGoogle}>
        <button
          type="submit"
          className="flex w-full items-center justify-center gap-2 rounded-md border border-ink-700 bg-ink-950 px-4 py-2 font-medium text-ink-100 transition hover:border-ink-500 hover:bg-white/[0.03]"
        >
          <GoogleIcon />
          Entrar com Google
        </button>
      </form>
      {googleError && (
        <p className="mt-3 text-center text-xs text-status-overdue">
          Não foi possível entrar com o Google. Tente novamente.
        </p>
      )}
    </>
  );
}

function GoogleIcon() {
  return (
    <svg className="size-4" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M23.52 12.27c0-.85-.08-1.67-.22-2.45H12v4.64h6.48a5.55 5.55 0 0 1-2.4 3.64v3.02h3.88c2.27-2.09 3.57-5.17 3.57-8.85Z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.96-1.07 7.95-2.9l-3.88-3a7.4 7.4 0 0 1-11-3.9H1.08v3.11A12 12 0 0 0 12 24Z"
      />
      <path
        fill="#FBBC05"
        d="M5.07 14.2a7.2 7.2 0 0 1 0-4.6V6.49H1.08a12 12 0 0 0 0 11.02l3.99-3.31Z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.76 0 3.34.6 4.59 1.79l3.44-3.44C17.95 1.19 15.23 0 12 0A12 12 0 0 0 1.08 6.49l3.99 3.11A7.16 7.16 0 0 1 12 4.75Z"
      />
    </svg>
  );
}
