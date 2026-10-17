"use client";

import { useActionState, useState } from "react";
import { verifyTotpChallenge, verifyBackupCode, type ChallengeState } from "@/app/actions/mfa";

const inputClass =
  "w-full rounded-md border border-ink-700 bg-ink-950 px-3 py-2 tracking-widest text-ink-50 placeholder:text-ink-500 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500";
const buttonClass =
  "w-full rounded-md bg-gradient-to-b from-amber-300 to-amber-500 px-4 py-2 font-semibold text-ink-950 glow-amber transition hover:brightness-105 disabled:opacity-60";

export function TotpChallenge() {
  const [useBackup, setUseBackup] = useState(false);
  const [totpState, totpAction, totpPending] = useActionState<ChallengeState, FormData>(
    verifyTotpChallenge,
    undefined
  );
  const [backupState, backupAction, backupPending] = useActionState<ChallengeState, FormData>(
    verifyBackupCode,
    undefined
  );

  if (useBackup) {
    return (
      <form action={backupAction} className="mt-6 space-y-4">
        <p className="text-sm text-ink-300">
          Digite um dos seus códigos de backup. Ao usá-lo, seu autenticador atual será
          desativado e você precisará cadastrar um novo.
        </p>
        <input
          name="code"
          required
          autoComplete="off"
          placeholder="XXXXX-XXXXX"
          className={`${inputClass} font-mono`}
        />
        {backupState?.error && <p className="text-sm text-status-overdue">{backupState.error}</p>}
        <button type="submit" disabled={backupPending} className={buttonClass}>
          {backupPending ? "Verificando..." : "Usar código de backup"}
        </button>
        <button
          type="button"
          onClick={() => setUseBackup(false)}
          className="w-full text-center text-sm text-ink-500 underline"
        >
          Voltar para o código do autenticador
        </button>
      </form>
    );
  }

  return (
    <form action={totpAction} className="mt-6 space-y-4">
      <p className="text-sm text-ink-300">
        Digite o código de 6 dígitos gerado pelo seu app autenticador.
      </p>
      <input
        name="code"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9 ]{6,7}"
        maxLength={7}
        required
        autoFocus
        className={inputClass}
      />
      {totpState?.error && <p className="text-sm text-status-overdue">{totpState.error}</p>}
      <button type="submit" disabled={totpPending} className={buttonClass}>
        {totpPending ? "Verificando..." : "Entrar"}
      </button>
      <button
        type="button"
        onClick={() => setUseBackup(true)}
        className="w-full text-center text-sm text-ink-500 underline"
      >
        Perdi acesso ao autenticador
      </button>
    </form>
  );
}
