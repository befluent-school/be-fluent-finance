"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { login, type LoginState } from "@/app/actions/auth";

export function LoginForm({ notice }: { notice?: { tone: "ok" | "error"; text: string } }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(login, undefined);
  const [showPassword, setShowPassword] = useState(false);

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
          inputMode="email"
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
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
        <div className="relative mt-1">
          <input
            id="password"
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            required
            className="w-full rounded-md border border-ink-700 bg-ink-950 py-2 pl-3 pr-11 text-ink-50 placeholder:text-ink-500 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
          />
          {/* No celular é fácil o teclado ou o preenchimento automático trocar
              a senha sem o usuário perceber: deixa conferir o que foi digitado. */}
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
            aria-pressed={showPassword}
            className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-ink-400 hover:text-ink-50"
          >
            {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </div>
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
