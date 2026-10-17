"use client";

import { useActionState, useCallback, useEffect, useRef, useState } from "react";
import {
  finishEnrollment,
  startTotpEnrollment,
  verifyTotpEnrollment,
  type EnrollResult,
  type VerifyEnrollmentState,
} from "@/app/actions/mfa";

type Enrollment = Exclude<EnrollResult, { error: string }>;

const inputClass =
  "mt-1 w-full rounded-md border border-ink-700 bg-ink-950 px-3 py-2 tracking-widest text-ink-50 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500";

export function TotpEnroll() {
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [state, action, pending] = useActionState<VerifyEnrollmentState, FormData>(
    verifyTotpEnrollment,
    undefined
  );
  // Gera o segredo uma única vez por montagem (o StrictMode do React roda
  // efeitos duas vezes em dev; dois segredos fariam o QR exibido não bater).
  const started = useRef(false);

  const start = useCallback(() => {
    setLoadError(null);
    setEnrollment(null);
    startTotpEnrollment()
      .then((result) => ("error" in result ? setLoadError(result.error) : setEnrollment(result)))
      .catch(() => setLoadError("Não foi possível iniciar o cadastro do 2FA."));
  }, []);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    start();
  }, [start]);

  if (state?.backupCodes) {
    return (
      <div className="mt-6 space-y-4">
        <p className="text-sm font-medium text-ink-100">
          2FA ativado. Guarde estes códigos de backup em local seguro — cada um pode ser
          usado uma única vez para entrar caso você perca acesso ao autenticador. Eles não
          serão mostrados de novo.
        </p>
        <ul className="font-tabular grid grid-cols-2 gap-2 rounded-md border border-ink-700 bg-ink-950 p-4 font-mono text-sm text-ink-50">
          {state.backupCodes.map((code) => (
            <li key={code}>{code}</li>
          ))}
        </ul>
        <form action={finishEnrollment}>
          <button
            type="submit"
            className="w-full rounded-md bg-gradient-to-b from-amber-300 to-amber-500 px-4 py-2 text-center font-semibold text-ink-950 glow-amber transition hover:brightness-105"
          >
            Já guardei meus códigos — continuar
          </button>
        </form>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="mt-6 space-y-3">
        <p className="text-sm text-status-overdue">{loadError}</p>
        <button type="button" onClick={start} className="text-sm text-ink-300 underline">
          Tentar novamente
        </button>
      </div>
    );
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
        <span className="break-all font-mono text-ink-300">{enrollment.secret}</span>
      </p>

      {enrollment.emailCodeRequired && (
        <div>
          <label htmlFor="emailCode" className="block text-sm font-medium text-ink-100">
            Código enviado para {enrollment.maskedEmail}
          </label>
          <input
            id="emailCode"
            name="emailCode"
            autoComplete="off"
            placeholder="XXXX-XXXX"
            required
            className={`${inputClass} font-mono`}
          />
          <button type="button" onClick={start} className="mt-1 text-xs text-ink-500 underline">
            Não recebi — gerar novo QR e reenviar
          </button>
        </div>
      )}

      <div>
        <label htmlFor="code" className="block text-sm font-medium text-ink-100">
          Código do autenticador
        </label>
        <input
          id="code"
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9 ]{6,7}"
          maxLength={7}
          required
          className={inputClass}
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
