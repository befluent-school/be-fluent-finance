"use client";

import { useActionState, useState } from "react";
import { verifyTotpChallenge, verifyBackupCode, type ChallengeState } from "@/app/actions/mfa";

export function TotpChallenge({ factorId }: { factorId: string }) {
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
        <input type="hidden" name="factorId" value={factorId} />
        <input
          name="code"
          required
          placeholder="XXXXX-XXXXX"
          className="w-full rounded-md border border-ink-700 bg-ink-950 px-3 py-2 font-mono tracking-widest text-ink-50 placeholder:text-ink-500 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
        />
        {backupState?.error && <p className="text-sm text-status-overdue">{backupState.error}</p>}
        <button
          type="submit"
          disabled={backupPending}
          className="w-full rounded-md bg-gradient-to-b from-amber-300 to-amber-500 px-4 py-2 font-semibold text-ink-950 glow-amber transition hover:brightness-105 disabled:opacity-60"
        >
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
      <input type="hidden" name="factorId" value={factorId} />
      <input
        name="code"
        inputMode="numeric"
        pattern="[0-9]{6}"
        maxLength={6}
        required
        autoFocus
        className="w-full rounded-md border border-ink-700 bg-ink-950 px-3 py-2 tracking-widest text-ink-50 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
      />
      {totpState?.error && <p className="text-sm text-status-overdue">{totpState.error}</p>}
      <button
        type="submit"
        disabled={totpPending}
        className="w-full rounded-md bg-gradient-to-b from-amber-300 to-amber-500 px-4 py-2 font-semibold text-ink-950 glow-amber transition hover:brightness-105 disabled:opacity-60"
      >
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
