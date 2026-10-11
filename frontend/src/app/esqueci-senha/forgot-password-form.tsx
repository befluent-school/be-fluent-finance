"use client";

import Link from "next/link";
import { useActionState } from "react";
import { requestPasswordReset, type ForgotPasswordState } from "@/app/actions/auth";

export function ForgotPasswordForm() {
  const [state, action, pending] = useActionState<ForgotPasswordState, FormData>(
    requestPasswordReset,
    undefined
  );

  if (state?.message) {
    return (
      <div className="mt-8 space-y-4">
        <p className="text-sm text-ink-100">{state.message}</p>
        <Link href="/login" className="block text-center text-sm text-ink-300 underline hover:text-ink-50">
          Voltar ao login
        </Link>
      </div>
    );
  }

  return (
    <form action={action} className="mt-8 space-y-4">
      <div>
        <label htmlFor="email" className="block text-sm font-medium text-ink-100">
          E-mail da conta
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          required
          className="mt-1 w-full rounded-md border border-ink-700 bg-ink-950 px-3 py-2 text-ink-50 placeholder:text-ink-500 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
        />
      </div>

      {state?.error && <p className="text-sm text-status-overdue">{state.error}</p>}

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-md bg-gradient-to-b from-amber-300 to-amber-500 px-4 py-2 font-semibold text-ink-950 glow-amber transition hover:brightness-105 disabled:opacity-60"
      >
        {pending ? "Enviando..." : "Enviar link"}
      </button>

      <p className="text-center text-sm">
        <Link href="/login" className="text-ink-300 underline hover:text-ink-50">
          Voltar ao login
        </Link>
      </p>
    </form>
  );
}
