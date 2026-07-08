"use client";

import { useState, useTransition } from "react";
import { getFinancialInsights } from "@/app/actions/insights";

export function AiInsightsCard() {
  const [isPending, startTransition] = useTransition();
  const [insights, setInsights] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notConfigured, setNotConfigured] = useState(false);

  function handleGenerate() {
    setError(null);
    startTransition(async () => {
      const result = await getFinancialInsights();
      if ("error" in result) {
        if (result.error === "not_configured") {
          setNotConfigured(true);
        } else {
          setError(result.error);
        }
        return;
      }
      setInsights(result.insights);
    });
  }

  return (
    <div className="card-premium animate-rise rounded-lg p-6">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-300">
          Análise com IA
        </p>
        {!notConfigured && (
          <button
            onClick={handleGenerate}
            disabled={isPending}
            className="rounded-md bg-gradient-to-b from-amber-300 to-amber-500 px-3 py-1.5 text-xs font-semibold text-ink-950 glow-amber transition hover:brightness-105 disabled:opacity-60"
          >
            {isPending ? "Analisando..." : insights ? "Gerar novamente" : "Gerar análise"}
          </button>
        )}
      </div>

      {notConfigured && (
        <p className="mt-3 text-sm text-ink-500">
          IA não configurada — defina OPENAI_API_KEY para habilitar esta análise.
        </p>
      )}

      {error && <p className="mt-3 text-sm text-status-overdue">{error}</p>}

      {!notConfigured && !error && !insights && !isPending && (
        <p className="mt-3 text-sm text-ink-500">
          Gere uma análise crítica da saúde financeira com base nos dados reais do mês.
        </p>
      )}

      {insights && (
        <ul className="mt-3 space-y-2">
          {insights.map((point, i) => (
            <li key={i} className="flex gap-2 text-sm text-ink-100">
              <span className="mt-1 size-1 shrink-0 rounded-full bg-amber-500" aria-hidden="true" />
              <span>{point}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
