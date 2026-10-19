"use client";

import { useEffect } from "react";
import Link from "next/link";
import { reportClientError } from "@/lib/report-client-error";

/** Erro numa tela interna: mantém menu e topo, mostra aviso e deixa tentar de novo. */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    reportClientError("pagina", error, error.digest ? `digest=${error.digest}` : undefined);
  }, [error]);

  return (
    <div className="card-premium mx-auto mt-10 max-w-lg rounded-lg p-6 text-center">
      <p className="text-3xl" aria-hidden>
        ⚠️
      </p>
      <h1 className="mt-2 font-display text-lg font-bold text-ink-50">Esta tela teve um problema</h1>
      <p className="mt-2 text-sm text-ink-300">
        Nada foi perdido: seus dados estão salvos. O erro já foi registrado para correção.
      </p>
      <div className="mt-5 flex justify-center gap-3">
        <button
          type="button"
          onClick={reset}
          className="rounded-md bg-gradient-to-b from-amber-300 to-amber-500 px-4 py-2 text-sm font-semibold text-ink-950"
        >
          Tentar de novo
        </button>
        <Link href="/dashboard" className="rounded-md px-4 py-2 text-sm text-ink-300 ring-1 ring-inset ring-ink-700 hover:text-ink-50">
          Ir para o Dashboard
        </Link>
      </div>
    </div>
  );
}
