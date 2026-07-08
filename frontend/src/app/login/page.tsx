"use client";

import { useActionState } from "react";
import { login, type LoginState } from "@/app/actions/auth";

export default function LoginPage() {
  const [state, action, pending] = useActionState<LoginState, FormData>(login, undefined);

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-ink-950 px-4">
      <HexPattern />
      <div className="pointer-events-none absolute left-1/2 top-1/2 h-[600px] w-[600px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-amber-500/[0.07] blur-[120px]" />

      <div className="card-premium animate-rise relative w-full max-w-sm rounded-lg p-8 shadow-[var(--shadow-elevated)]">
        <div className="mb-1 h-1 w-10 rounded-full bg-gradient-to-r from-amber-600 to-amber-400" />
        <h1 className="font-display gradient-text text-3xl font-bold">Be Fluent</h1>
        <p className="mt-1 text-sm text-ink-300">Gestão financeira e administrativa</p>

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
      </div>
    </main>
  );
}

function HexPattern() {
  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full opacity-[0.06]"
      aria-hidden="true"
    >
      <defs>
        <pattern id="hex" width="56" height="98" patternUnits="userSpaceOnUse" patternTransform="scale(1)">
          <path
            d="M28 0 L56 16 L56 49 L28 65 L0 49 L0 16 Z"
            fill="none"
            stroke="#f0a520"
            strokeWidth="1.5"
          />
          <path
            d="M28 65 L56 81 L56 114 L28 130 L0 114 L0 81 Z"
            fill="none"
            stroke="#f0a520"
            strokeWidth="1.5"
          />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#hex)" />
    </svg>
  );
}
