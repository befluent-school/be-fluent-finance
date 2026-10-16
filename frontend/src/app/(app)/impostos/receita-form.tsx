"use client";

import { useActionState } from "react";
import { saveReceitaInformada, type ReceitaState } from "@/app/actions/simples";
import { formatCurrencyBRL } from "@shared/finance";

export type ReceitaFormRow = {
  month: string;
  label: string;
  calculada: number;
  informada: number | null;
  coberto: boolean;
};

const inputClass =
  "w-full rounded-md border border-ink-700 bg-ink-950 px-3 py-2 text-right font-tabular text-ink-50 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500";

function toInput(v: number | null): string {
  return v === null ? "" : v.toFixed(2).replace(".", ",");
}

export function ReceitaForm({ rows }: { rows: ReceitaFormRow[] }) {
  const [state, action, pending] = useActionState<ReceitaState, FormData>(saveReceitaInformada, undefined);

  return (
    <form action={action} className="card-premium rounded-md p-4">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map((r) => {
          const pendente = r.informada === null && !r.coberto;
          return (
            <label
              key={r.month}
              className={`rounded-md border p-3 ${pendente ? "border-status-overdue/50 bg-status-overdue-bg" : "border-ink-700"}`}
            >
              <span className="flex items-center justify-between text-sm">
                <span className="font-medium capitalize text-ink-50">{r.label}</span>
                <span className={`text-xs ${pendente ? "text-status-overdue" : "text-ink-500"}`}>
                  {r.informada !== null ? "Declarada" : r.coberto ? "Pelos bancos" : "Falta informar"}
                </span>
              </span>
              <input
                name={`receita_${r.month}`}
                inputMode="decimal"
                placeholder={r.coberto ? toInput(r.calculada) : "0,00"}
                defaultValue={toInput(r.informada)}
                className={`mt-2 ${inputClass}`}
              />
              <span className="mt-1 block text-xs text-ink-500">
                Calculado pelos bancos: {formatCurrencyBRL(r.calculada)}
                {!r.coberto && " (mês incompleto)"}
              </span>
            </label>
          );
        })}
      </div>
      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-ink-500">
          Use a receita bruta do PGDAS-D (extrato do Simples enviado pela contabilidade). Campo vazio = usa o valor
          calculado pelos bancos.
        </p>
        <div className="flex items-center gap-3">
          {state?.message && <span className="text-sm text-status-overdue">{state.message}</span>}
          {state?.success && <span className="text-sm text-status-paid">Salvo.</span>}
          <button
            type="submit"
            disabled={pending}
            className="rounded-md bg-amber-500 px-4 py-2 text-sm font-semibold text-ink-950 hover:bg-amber-400 disabled:opacity-60"
          >
            {pending ? "Salvando…" : "Salvar receitas"}
          </button>
        </div>
      </div>
    </form>
  );
}
