"use client";

import { useActionState } from "react";
import { updateAutomationSettings, type SettingsState } from "@/app/actions/automation";

const inputClass =
  "mt-1 w-full rounded-md border border-ink-700 bg-ink-950 px-3 py-2 text-ink-50 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500";

export function SettingsForm({
  rolloverEnabled,
  invoiceDay,
  dasDueDay,
  anexo,
}: {
  rolloverEnabled: boolean;
  invoiceDay: number;
  dasDueDay: number;
  anexo: string;
}) {
  const [state, action, pending] = useActionState<SettingsState, FormData>(updateAutomationSettings, undefined);

  return (
    <form action={action} className="card-premium space-y-4 rounded-md p-6">
      <label className="flex items-center gap-3">
        <input type="checkbox" name="rollover_enabled" value="on" defaultChecked={rolloverEnabled} className="size-4 accent-amber-500" />
        <span className="text-sm text-ink-100">Automação de virada de mês ativada</span>
      </label>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div>
          <label className="block text-sm font-medium text-ink-100">Dia de geração das mensalidades</label>
          <input name="invoice_generation_day" type="number" min={1} max={28} defaultValue={invoiceDay} className={inputClass} />
        </div>
        <div>
          <label className="block text-sm font-medium text-ink-100">Dia de vencimento do DAS</label>
          <input name="das_due_day" type="number" min={1} max={28} defaultValue={dasDueDay} className={inputClass} />
        </div>
        <div>
          <label className="block text-sm font-medium text-ink-100">Anexo do Simples</label>
          <select name="simples_anexo" defaultValue={anexo} className={inputClass}>
            <option value="III">Anexo III (padrão — ensino)</option>
            <option value="V">Anexo V</option>
          </select>
        </div>
      </div>

      {state?.error && <p className="text-sm text-status-overdue">{state.error}</p>}
      {state?.ok && <p className="text-sm text-status-paid">Configurações salvas.</p>}

      <div className="flex justify-end">
        <button type="submit" disabled={pending} className="rounded-md bg-gradient-to-b from-amber-300 to-amber-500 px-4 py-2 text-sm font-semibold text-ink-950 glow-amber transition hover:brightness-105 disabled:opacity-60">
          {pending ? "Salvando..." : "Salvar configurações"}
        </button>
      </div>
    </form>
  );
}
