"use client";

import { useActionState, useEffect, useRef } from "react";
import { Pencil } from "lucide-react";
import { setTeacherActive, updateTeacher, type TeacherFormState } from "@/app/actions/teachers";
import type { PayrollRow } from "@/lib/payroll-shared";
import { PAYMENT_TYPES } from "./payment-types";

const inputClass =
  "mt-1 w-full rounded-md border border-ink-700 bg-ink-950 px-3 py-2 text-ink-50 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500";

/** Edita nome e regra de pagamento de um professor, ou o desativa. */
export function EditTeacherDialog({ row }: { row: PayrollRow }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [state, action, pending] = useActionState<TeacherFormState, FormData>(updateTeacher, undefined);
  const [activeState, activeAction, togglingActive] = useActionState<TeacherFormState, FormData>(
    setTeacherActive,
    undefined,
  );

  useEffect(() => {
    if (state?.success || activeState?.success) dialogRef.current?.close();
  }, [state, activeState]);

  return (
    <>
      <button
        type="button"
        onClick={() => dialogRef.current?.showModal()}
        aria-label={`Editar ${row.full_name}`}
        title="Editar professor"
        className="rounded p-1 text-ink-500 hover:bg-white/[0.06] hover:text-amber-300"
      >
        <Pencil className="size-3.5" />
      </button>

      <dialog ref={dialogRef} className="card-premium w-full max-w-md rounded-lg p-0 text-left text-ink-50 backdrop:bg-black/70">
        <form action={action} className="space-y-4 p-6">
          <h2 className="font-display text-base font-bold">Editar professor</h2>
          <input type="hidden" name="id" value={row.teacher_id} />

          <div>
            <label className="block text-sm font-medium text-ink-100">Nome completo</label>
            <input name="fullName" required defaultValue={row.full_name} className={inputClass} />
            {state?.errors?.fullName && <p className="mt-1 text-xs text-status-overdue">{state.errors.fullName[0]}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium text-ink-100">Forma de pagamento</label>
            <select name="paymentType" className={inputClass} defaultValue={row.payment_type}>
              {PAYMENT_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
            <ul className="mt-1 space-y-0.5 text-xs text-ink-500">
              {PAYMENT_TYPES.map((t) => (
                <li key={t.value}>
                  <strong className="text-ink-400">{t.label}:</strong> {t.hint}
                </li>
              ))}
            </ul>
          </div>

          <div>
            <label className="block text-sm font-medium text-ink-100">Valor de referência</label>
            <input
              name="paymentReferenceValue"
              type="number"
              step="0.01"
              min="0"
              defaultValue={row.payment_reference_value ?? ""}
              className={inputClass}
              placeholder="Ex.: 35.00 (R$/aula) ou 40 (%)"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-ink-100">Regra (observação)</label>
            <textarea name="paymentRuleText" rows={2} defaultValue={row.payment_rule_text ?? ""} className={inputClass} />
          </div>

          {(state?.message || activeState?.message) && (
            <p className="text-sm text-status-overdue">{state?.message || activeState?.message}</p>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
            <button
              type="submit"
              formAction={activeAction}
              formNoValidate
              name="active"
              value="false"
              disabled={togglingActive}
              className="rounded-md px-3 py-2 text-sm text-status-overdue ring-1 ring-inset ring-status-overdue/40 hover:bg-status-overdue/10 disabled:opacity-60"
              title="O professor some da folha e da importação de alunos. O histórico é mantido."
            >
              {togglingActive ? "…" : "Desativar professor"}
            </button>
            <div className="flex gap-3">
              <button type="button" onClick={() => dialogRef.current?.close()} className="rounded-md px-4 py-2 text-sm text-ink-300 hover:text-ink-50">
                Cancelar
              </button>
              <button
                type="submit"
                disabled={pending}
                className="rounded-md bg-gradient-to-b from-amber-300 to-amber-500 px-4 py-2 text-sm font-semibold text-ink-950 disabled:opacity-60"
              >
                {pending ? "Salvando…" : "Salvar"}
              </button>
            </div>
          </div>
        </form>
      </dialog>
    </>
  );
}
