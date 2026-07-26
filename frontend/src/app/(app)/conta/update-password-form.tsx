"use client";

import { useActionState } from "react";
import { updatePassword, type UpdatePasswordState } from "@/app/actions/auth";

export function UpdatePasswordForm() {
  const [state, action, pending] = useActionState<UpdatePasswordState, FormData>(
    updatePassword,
    undefined
  );

  return (
    <form action={action} className="space-y-4">
      <div>
        <label htmlFor="password" className="block text-sm font-medium text-ink-100">
          Nova senha
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          minLength={6}
          className="mt-1 w-full rounded-md border border-ink-700 bg-ink-950 px-3 py-2 text-ink-50 placeholder:text-ink-500 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
        />
        {state?.errors?.password && (
          <p className="mt-1 text-xs text-status-overdue">{state.errors.password[0]}</p>
        )}
      </div>

      <div>
        <label htmlFor="confirmPassword" className="block text-sm font-medium text-ink-100">
          Confirmar nova senha
        </label>
        <input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          required
          minLength={6}
          className="mt-1 w-full rounded-md border border-ink-700 bg-ink-950 px-3 py-2 text-ink-50 placeholder:text-ink-500 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
        />
        {state?.errors?.confirmPassword && (
          <p className="mt-1 text-xs text-status-overdue">{state.errors.confirmPassword[0]}</p>
        )}
      </div>

      {state?.message && (
        <p className={`text-sm ${state.success ? "text-status-paid" : "text-status-overdue"}`}>
          {state.message}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-md bg-gradient-to-b from-amber-300 to-amber-500 px-4 py-2 font-semibold text-ink-950 glow-amber transition hover:brightness-105 disabled:opacity-60"
      >
        {pending ? "Salvando..." : "Salvar nova senha"}
      </button>
    </form>
  );
}
