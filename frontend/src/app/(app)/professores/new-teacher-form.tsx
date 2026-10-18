"use client";

import { useActionState, useEffect, useRef } from "react";
import { createTeacherForm, type TeacherFormState } from "@/app/actions/teachers";
import { PAYMENT_TYPES } from "./payment-types";

const inputClass =
  "mt-1 w-full rounded-md border border-ink-700 bg-ink-950 px-3 py-2 text-ink-50 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500";


export function NewTeacherForm() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [state, action, pending] = useActionState<TeacherFormState, FormData>(createTeacherForm, undefined);

  useEffect(() => {
    if (state?.success) dialogRef.current?.close();
  }, [state]);

  return (
    <>
      <button
        onClick={() => dialogRef.current?.showModal()}
        className="rounded-md bg-gradient-to-b from-amber-300 to-amber-500 px-4 py-2 text-sm font-semibold text-ink-950 glow-amber transition hover:brightness-105"
      >
        Novo professor
      </button>

      <dialog ref={dialogRef} className="card-premium w-full max-w-md rounded-lg p-0 text-ink-50 backdrop:bg-black/70">
        <form action={action} className="space-y-4 p-6">
          <h2 className="font-display text-base font-bold">Novo professor</h2>

          <div>
            <label className="block text-sm font-medium text-ink-100">Nome completo</label>
            <input name="fullName" required className={inputClass} placeholder="Ex.: Isabella" />
            {state?.errors?.fullName && <p className="mt-1 text-xs text-status-overdue">{state.errors.fullName[0]}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium text-ink-100">Forma de pagamento</label>
            <select name="paymentType" className={inputClass} defaultValue="por_hora">
              {PAYMENT_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-ink-100">Valor de referência</label>
            <input name="paymentReferenceValue" type="number" step="0.01" min="0" className={inputClass} placeholder="Ex.: 35.00" />
            <p className="mt-1 text-xs text-ink-500">
              Por hora: R$ por aula. Fixo: R$ do mês. Comissão: o percentual (ex.: 40). Repasse: deixe vazio.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-ink-100">Regra (observação)</label>
            <textarea name="paymentRuleText" rows={2} className={inputClass} placeholder="Ex.: R$ 35,00 por hora de aula" />
          </div>

          {state?.message && <p className="text-sm text-status-overdue">{state.message}</p>}

          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={() => dialogRef.current?.close()} className="rounded-md px-4 py-2 text-sm text-ink-300 hover:text-ink-50">
              Cancelar
            </button>
            <button
              type="submit"
              disabled={pending}
              className="rounded-md bg-gradient-to-b from-amber-300 to-amber-500 px-4 py-2 text-sm font-semibold text-ink-950 disabled:opacity-60"
            >
              {pending ? "Salvando…" : "Cadastrar"}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
