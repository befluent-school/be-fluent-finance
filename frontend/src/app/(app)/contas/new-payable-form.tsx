"use client";

import { useActionState, useEffect, useRef } from "react";
import { createPayable, type PayableState } from "@/app/actions/payables";

const inputClass =
  "mt-1 w-full rounded-md border border-ink-700 bg-ink-950 px-3 py-2 text-ink-50 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500";

export function NewPayableForm({
  referenceMonth,
  categories,
}: {
  referenceMonth: string; // YYYY-MM
  categories: { id: string; name: string }[];
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [state, action, pending] = useActionState<PayableState, FormData>(createPayable, undefined);

  useEffect(() => {
    if (state?.success) dialogRef.current?.close();
  }, [state]);

  const defaultDue = `${referenceMonth}-10`;

  return (
    <>
      <button
        onClick={() => dialogRef.current?.showModal()}
        className="rounded-md bg-gradient-to-b from-amber-300 to-amber-500 px-4 py-2 text-sm font-semibold text-ink-950 glow-amber transition hover:brightness-105"
      >
        Nova conta a pagar
      </button>

      <dialog ref={dialogRef} className="card-premium w-full max-w-md rounded-lg p-0 text-ink-50 backdrop:bg-black/70">
        <form action={action} className="space-y-4 p-6">
          <h2 className="font-display text-base font-bold">Nova conta a pagar</h2>
          <input type="hidden" name="referenceMonth" value={`${referenceMonth}-01`} />

          <div>
            <label className="block text-sm font-medium text-ink-100">Descrição</label>
            <input name="description" required className={inputClass} placeholder="Ex.: Aluguel da sala" />
            {state?.errors?.description && <p className="mt-1 text-xs text-status-overdue">{state.errors.description[0]}</p>}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-ink-100">Valor (R$)</label>
              <input name="amount" type="number" step="0.01" min="0" required className={inputClass} />
              {state?.errors?.amount && <p className="mt-1 text-xs text-status-overdue">{state.errors.amount[0]}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium text-ink-100">Vencimento</label>
              <input name="dueDate" type="date" required defaultValue={defaultDue} className={inputClass} />
              {state?.errors?.dueDate && <p className="mt-1 text-xs text-status-overdue">{state.errors.dueDate[0]}</p>}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-ink-100">Categoria</label>
            <select name="categoryId" className={inputClass} defaultValue="">
              <option value="">Sem categoria</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-ink-100">Observações</label>
            <input name="notes" className={inputClass} />
          </div>

          {state?.message && <p className="text-sm text-status-overdue">{state.message}</p>}

          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={() => dialogRef.current?.close()} className="rounded-md px-4 py-2 text-sm font-medium text-ink-300 hover:text-ink-50">
              Cancelar
            </button>
            <button type="submit" disabled={pending} className="rounded-md bg-gradient-to-b from-amber-300 to-amber-500 px-4 py-2 text-sm font-semibold text-ink-950 glow-amber transition hover:brightness-105 disabled:opacity-60">
              {pending ? "Salvando..." : "Lançar"}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
