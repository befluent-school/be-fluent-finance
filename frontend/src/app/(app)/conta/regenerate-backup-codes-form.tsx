"use client";

import { useActionState } from "react";
import { regenerateBackupCodes, type RegenerateBackupState } from "@/app/actions/mfa";

export function RegenerateBackupCodesForm() {
  const [state, action, pending] = useActionState<RegenerateBackupState, FormData>(
    regenerateBackupCodes,
    undefined
  );

  if (state?.backupCodes) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-ink-100">
          Novos códigos gerados. Guarde-os agora — não serão mostrados de novo.
        </p>
        <ul className="font-tabular grid grid-cols-2 gap-2 rounded-md border border-ink-700 bg-ink-950 p-4 font-mono text-sm text-ink-50">
          {state.backupCodes.map((code) => (
            <li key={code}>{code}</li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-4">
      <div>
        <label htmlFor="backup-code-totp" className="block text-sm font-medium text-ink-100">
          Código atual do autenticador
        </label>
        <input
          id="backup-code-totp"
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]{6}"
          maxLength={6}
          required
          className="mt-1 w-full rounded-md border border-ink-700 bg-ink-950 px-3 py-2 tracking-widest text-ink-50 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
        />
      </div>
      {state?.error && <p className="text-sm text-status-overdue">{state.error}</p>}
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-md bg-white/[0.06] px-4 py-2 text-sm font-semibold text-ink-100 hover:bg-white/[0.1] disabled:opacity-60"
      >
        {pending ? "Gerando..." : "Gerar novos códigos"}
      </button>
    </form>
  );
}
