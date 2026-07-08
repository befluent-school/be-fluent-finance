"use client";

import { useActionState, useEffect, useRef } from "react";
import { enrollStudent, type EnrollStudentState } from "@/app/actions/students";
import type { Plan, Teacher } from "@shared/types";

const inputClass =
  "mt-1 w-full rounded-md border border-ink-700 bg-ink-950 px-3 py-2 text-ink-50 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500";
const labelClass = "block text-sm font-medium text-ink-100";

export function EnrollStudentForm({
  plans,
  teachers,
  defaultValues,
  trigger,
}: {
  plans: Plan[];
  teachers: Teacher[];
  defaultValues?: { fullName?: string; email?: string; phone?: string };
  trigger?: React.ReactNode;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [state, action, pending] = useActionState<EnrollStudentState, FormData>(
    enrollStudent,
    undefined
  );

  useEffect(() => {
    if (state?.success) {
      dialogRef.current?.close();
    }
  }, [state]);

  return (
    <>
      <button
        onClick={() => dialogRef.current?.showModal()}
        className={
          trigger
            ? "contents"
            : "rounded-md bg-gradient-to-b from-amber-300 to-amber-500 px-4 py-2 text-sm font-semibold text-ink-950 glow-amber transition hover:brightness-105"
        }
      >
        {trigger ?? "+ Novo aluno"}
      </button>

      <dialog
        ref={dialogRef}
        className="card-premium w-full max-w-lg rounded-lg p-0 text-ink-50 backdrop:bg-black/70"
      >
        <form action={action} className="space-y-4 p-6">
          <h2 className="font-display text-lg font-bold text-ink-50">Cadastrar aluno</h2>

          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className={labelClass}>Nome do aluno</label>
              <input
                name="fullName"
                required
                defaultValue={defaultValues?.fullName}
                className={inputClass}
              />
              {state?.errors?.fullName && (
                <p className="mt-1 text-xs text-status-overdue">{state.errors.fullName[0]}</p>
              )}
            </div>

            <div className="col-span-2">
              <label className={labelClass}>Responsável pelo pagamento (se diferente)</label>
              <input name="payerName" className={inputClass} />
            </div>

            <div>
              <label className={labelClass}>CPF</label>
              <input name="cpf" className={inputClass} />
            </div>

            <div>
              <label className={labelClass}>Telefone</label>
              <input name="phone" defaultValue={defaultValues?.phone} className={inputClass} />
            </div>

            <div className="col-span-2">
              <label className={labelClass}>E-mail</label>
              <input
                name="email"
                type="email"
                defaultValue={defaultValues?.email}
                className={inputClass}
              />
            </div>

            <div>
              <label className={labelClass}>Plano</label>
              <select name="planId" required className={inputClass}>
                <option value="">Selecione</option>
                {plans.map((plan) => (
                  <option key={plan.id} value={plan.id}>
                    {plan.name}
                  </option>
                ))}
              </select>
              {state?.errors?.planId && (
                <p className="mt-1 text-xs text-status-overdue">{state.errors.planId[0]}</p>
              )}
            </div>

            <div>
              <label className={labelClass}>Professor</label>
              <select name="teacherId" className={inputClass}>
                <option value="">A definir</option>
                {teachers.map((teacher) => (
                  <option key={teacher.id} value={teacher.id}>
                    {teacher.full_name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className={labelClass}>Valor da mensalidade</label>
              <input name="monthlyValue" type="number" step="0.01" required className={inputClass} />
              {state?.errors?.monthlyValue && (
                <p className="mt-1 text-xs text-status-overdue">{state.errors.monthlyValue[0]}</p>
              )}
            </div>

            <div>
              <label className={labelClass}>Dia de vencimento</label>
              <input
                name="dueDay"
                type="number"
                min={1}
                max={28}
                required
                className={inputClass}
              />
              {state?.errors?.dueDay && (
                <p className="mt-1 text-xs text-status-overdue">{state.errors.dueDay[0]}</p>
              )}
            </div>
          </div>

          {state?.message && <p className="text-sm text-status-overdue">{state.message}</p>}

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => dialogRef.current?.close()}
              className="rounded-md px-4 py-2 text-sm font-medium text-ink-300 hover:text-ink-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={pending}
              className="rounded-md bg-gradient-to-b from-amber-300 to-amber-500 px-4 py-2 text-sm font-semibold text-ink-950 glow-amber transition hover:brightness-105 disabled:opacity-60"
            >
              {pending ? "Salvando..." : "Cadastrar"}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
