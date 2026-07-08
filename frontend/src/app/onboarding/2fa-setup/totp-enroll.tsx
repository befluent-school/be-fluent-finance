"use client";

import { useActionState, useEffect, useState } from "react";
import {
  startTotpEnrollment,
  verifyTotpEnrollment,
  type EnrollResult,
  type VerifyEnrollmentState,
} from "@/app/actions/mfa";

export function TotpEnroll() {
  const [enrollment, setEnrollment] = useState<EnrollResult | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [state, action, pending] = useActionState<VerifyEnrollmentState, FormData>(
    verifyTotpEnrollment,
    undefined
  );

  useEffect(() => {
    startTotpEnrollment().then(setEnrollment).catch((err) => setLoadError(err.message));
  }, []);

  if (state?.backupCodes) {
    return (
      <div className="mt-6 space-y-4">
        <p className="text-sm font-medium text-ink-100">
          2FA ativado. Guarde estes códigos de backup em local seguro — cada um pode ser
          usado uma única vez para entrar caso você perca acesso ao autenticador.
        </p>
        <ul className="font-tabular grid grid-cols-2 gap-2 rounded-md border border-ink-700 bg-ink-950 p-4 font-mono text-sm text-ink-50">
          {state.backupCodes.map((code) => (
            <li key={code}>{code}</li>
          ))}
        </ul>
        <a
          href="/dashboard"
          className="inline-block w-full rounded-md bg-gradient-to-b from-amber-300 to-amber-500 px-4 py-2 text-center font-semibold text-ink-950 glow-amber transition hover:brightness-105"
        >
          Já guardei meus códigos — continuar
        </a>
      </div>
    );
  }

  if (loadError) {
    return <p className="mt-6 text-sm text-status-overdue">{loadError}</p>;
  }

  if (!enrollment) {
    return <p className="mt-6 text-sm text-ink-500">Gerando QR Code...</p>;
  }

  return (
    <form action={action} className="mt-6 space-y-4">
      <p className="text-sm text-ink-300">
        Escaneie o QR Code abaixo com o Google Authenticator (ou similar) e digite o código
        de 6 dígitos gerado.
      </p>

      <div className="mx-auto w-fit rounded-md bg-ink-50 p-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={enrollment.qrCode} alt="QR Code do 2FA" className="h-44 w-44" />
      </div>

      <p className="text-center text-xs text-ink-500">
        Não consegue escanear? Digite manualmente:{" "}
        <span className="font-mono text-ink-300">{enrollment.secret}</span>
      </p>

      <input type="hidden" name="factorId" value={enrollment.factorId} />

      <div>
        <label htmlFor="code" className="block text-sm font-medium text-ink-100">
          Código do autenticador
        </label>
        <input
          id="code"
          name="code"
          inputMode="numeric"
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
        className="w-full rounded-md bg-gradient-to-b from-amber-300 to-amber-500 px-4 py-2 font-semibold text-ink-950 glow-amber transition hover:brightness-105 disabled:opacity-60"
      >
        {pending ? "Verificando..." : "Confirmar e ativar 2FA"}
      </button>
    </form>
  );
}
