"use client";

import Link from "next/link";
import { useActionState } from "react";
import { login, type LoginState } from "@/app/actions/auth";

export function LoginForm({ notice }: { notice?: { tone: "ok" | "error"; text: string } }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(login, undefined);

  return (
    <form action={action} className="mt-8 space-y-4">
      {notice && (
        <p className={`text-sm ${notice.tone === "ok" ? "text-status-paid" : "text-status-overdue"}`}>
          {notice.text}
        </p>
      )}

      <div>
        <label htmlFor="email" className="block text-sm font-medium text-ink-100">
          E-mail
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
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
          autoComplete="current-password"
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

      <p className="text-center text-sm">
        <Link href="/esqueci-senha" className="text-ink-300 underline hover:text-ink-50">
          Esqueci minha senha
        </Link>
      </p>
    </form>
  );
}
