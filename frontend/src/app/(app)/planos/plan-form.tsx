"use client";

import { useActionState, useEffect, useRef } from "react";
import { createPlan, updatePlan, type PlanState } from "@/app/actions/plans";
import type { Plan } from "@shared/types";

const inputClass =
  "mt-1 w-full rounded-md border border-ink-700 bg-ink-950 px-3 py-2 text-ink-50 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500";
const labelClass = "block text-sm font-medium text-ink-100";

export function PlanForm({ plan, trigger }: { plan?: Plan; trigger?: React.ReactNode }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const isEdit = Boolean(plan);
  const [state, action, pending] = useActionState<PlanState, FormData>(
    isEdit ? updatePlan : createPlan,
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
        {trigger ?? "+ Novo plano"}
      </button>

      <dialog
        ref={dialogRef}
        className="card-premium w-full max-w-md rounded-lg p-0 text-ink-50 backdrop:bg-black/70"
      >
        <form action={action} className="space-y-4 p-6">
          <h2 className="font-display text-lg font-bold text-ink-50">
            {isEdit ? "Editar plano" : "Novo plano"}
          </h2>

          {isEdit && <input type="hidden" name="id" value={plan!.id} />}

          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className={labelClass}>Nome do plano</label>
              <input
                name="name"
                required
                defaultValue={plan?.name}
                className={inputClass}
              />
              {state?.errors?.name && (
                <p className="mt-1 text-xs text-status-overdue">{state.errors.name[0]}</p>
              )}
            </div>

            <div>
              <label className={labelClass}>Aulas por semana</label>
              <input
                name="lessonsPerWeek"
                type="number"
                min={1}
                required
                defaultValue={plan?.lessons_per_week}
                className={inputClass}
              />
              {state?.errors?.lessonsPerWeek && (
                <p className="mt-1 text-xs text-status-overdue">{state.errors.lessonsPerWeek[0]}</p>
              )}
            </div>

            <div>
              <label className={labelClass}>Mensalidade (R$)</label>
              <input
                name="monthlyValue"
                type="number"
                step="0.01"
                min={0}
                required
                defaultValue={plan?.monthly_value}
                className={inputClass}
              />
              {state?.errors?.monthlyValue && (
                <p className="mt-1 text-xs text-status-overdue">{state.errors.monthlyValue[0]}</p>
              )}
            </div>

            <div className="col-span-2">
              <label className={labelClass}>Duração média (meses)</label>
              <input
                name="avgDurationMonths"
                type="number"
                min={1}
                required
                defaultValue={plan?.avg_duration_months}
                className={inputClass}
              />
              {state?.errors?.avgDurationMonths && (
                <p className="mt-1 text-xs text-status-overdue">
                  {state.errors.avgDurationMonths[0]}
                </p>
              )}
            </div>

            {isEdit && (
              <div className="col-span-2 flex items-center gap-2">
                <input
                  id="plan-active"
                  name="active"
                  type="checkbox"
                  defaultChecked={plan?.active}
                  className="size-4 rounded border-ink-700 bg-ink-950 text-amber-500 focus:ring-amber-500"
                />
                <label htmlFor="plan-active" className="text-sm text-ink-100">
                  Plano ativo
                </label>
              </div>
            )}
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
              {pending ? "Salvando..." : isEdit ? "Salvar" : "Cadastrar"}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
