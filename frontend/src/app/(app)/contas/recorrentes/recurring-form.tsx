"use client";

import { todayBR } from "@/lib/dates";
import { useActionState, useEffect, useRef, useState } from "react";
import { createRecurringPayable, type RecurringState } from "@/app/actions/recurring-payables";

const inputClass =
  "mt-1 w-full rounded-md border border-ink-700 bg-ink-950 px-3 py-2 text-ink-50 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500";

export function RecurringForm({ categories }: { categories: { id: string; name: string }[] }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [state, action, pending] = useActionState<RecurringState, FormData>(createRecurringPayable, undefined);
  const thisMonth = todayBR().slice(0, 7);
  const [startMonth, setStartMonth] = useState(thisMonth);

  useEffect(() => {
    if (state?.success) dialogRef.current?.close();
  }, [state]);

  return (
    <>
      <button
        onClick={() => dialogRef.current?.showModal()}
        className="rounded-md bg-gradient-to-b from-amber-300 to-amber-500 px-4 py-2 text-sm font-semibold text-ink-950 glow-amber transition hover:brightness-105"
      >
        Nova conta recorrente
      </button>

      <dialog ref={dialogRef} className="card-premium w-full max-w-md rounded-lg p-0 text-ink-50 backdrop:bg-black/70">
        <form action={action} className="space-y-4 p-6">
          <h2 className="font-display text-base font-bold">Nova conta recorrente</h2>
          <p className="text-xs text-ink-400">
            Será gerada automaticamente todo mês (contador, pró-labore, aluguel, ferramentas…).
          </p>

          <div>
            <label className="block text-sm font-medium text-ink-100">Descrição</label>
            <input name="description" required className={inputClass} placeholder="Ex.: Assessoria Contábil" />
            {state?.errors?.description && <p className="mt-1 text-xs text-status-overdue">{state.errors.description[0]}</p>}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-ink-100">Valor (R$)</label>
              <input name="amount" type="number" step="0.01" min="0" required className={inputClass} />
              {state?.errors?.amount && <p className="mt-1 text-xs text-status-overdue">{state.errors.amount[0]}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium text-ink-100">Dia do vencimento</label>
              <input name="dueDay" type="number" min="1" max="28" required defaultValue={10} className={inputClass} />
              {state?.errors?.dueDay && <p className="mt-1 text-xs text-status-overdue">{state.errors.dueDay[0]}</p>}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-ink-100">A partir de</label>
              <input type="month" required value={startMonth} onChange={(e) => setStartMonth(e.target.value)} className={inputClass} />
              <input type="hidden" name="startMonth" value={startMonth ? `${startMonth}-01` : ""} />
              <p className="mt-1 text-[10px] text-ink-500">O 1º lançamento é gerado na virada deste mês.</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-ink-100">Categoria</label>
              <select name="categoryId" className={inputClass} defaultValue="">
                <option value="">Sem categoria</option>
                {categories.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
              </select>
            </div>
          </div>

          {state?.message && <p className="text-sm text-status-overdue">{state.message}</p>}

          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={() => dialogRef.current?.close()} className="rounded-md px-4 py-2 text-sm font-medium text-ink-300 hover:text-ink-50">Cancelar</button>
            <button type="submit" disabled={pending} className="rounded-md bg-gradient-to-b from-amber-300 to-amber-500 px-4 py-2 text-sm font-semibold text-ink-950 glow-amber transition hover:brightness-105 disabled:opacity-60">
              {pending ? "Salvando..." : "Criar"}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
