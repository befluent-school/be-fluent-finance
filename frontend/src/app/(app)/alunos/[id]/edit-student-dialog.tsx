"use client";

import { useActionState, useEffect, useRef } from "react";
import { updateStudent, type UpdateStudentState } from "@/app/actions/students";
import type { Plan, Teacher } from "@shared/types";

const inputClass =
  "mt-1 w-full rounded-md border border-ink-700 bg-ink-950 px-3 py-2 text-ink-50 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500";
const labelClass = "block text-sm font-medium text-ink-100";

type StudentData = {
  id: string;
  full_name: string;
  payer_name: string | null;
  cpf: string | null;
  phone: string | null;
  email: string | null;
};

type EnrollmentData = {
  id: string;
  monthly_value: number;
  due_day: number;
  plan_id: string;
  teacher_id: string | null;
} | null;

export function EditStudentDialog({
  student,
  enrollment,
  plans,
  teachers,
}: {
  student: StudentData;
  enrollment: EnrollmentData;
  plans: Plan[];
  teachers: Teacher[];
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [state, action, pending] = useActionState<UpdateStudentState, FormData>(
    updateStudent,
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
        className="rounded-md bg-white/[0.06] px-3 py-1.5 text-xs font-semibold text-ink-100 hover:bg-white/[0.1]"
      >
        Editar
      </button>

      <dialog
        ref={dialogRef}
        className="card-premium w-full max-w-lg rounded-lg p-0 text-ink-50 backdrop:bg-black/70"
      >
        <form action={action} className="space-y-4 p-6">
          <h2 className="font-display text-lg font-bold text-ink-50">Editar aluno</h2>

          <input type="hidden" name="studentId" value={student.id} />
          {enrollment && <input type="hidden" name="enrollmentId" value={enrollment.id} />}

          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className={labelClass}>Nome do aluno</label>
              <input
                name="fullName"
                required
                defaultValue={student.full_name}
                className={inputClass}
              />
              {state?.errors?.fullName && (
                <p className="mt-1 text-xs text-status-overdue">{state.errors.fullName[0]}</p>
              )}
            </div>

            <div className="col-span-2">
              <label className={labelClass}>Responsável pelo pagamento (se diferente)</label>
              <input name="payerName" defaultValue={student.payer_name ?? ""} className={inputClass} />
            </div>

            <div>
              <label className={labelClass}>CPF</label>
              <input name="cpf" defaultValue={student.cpf ?? ""} className={inputClass} />
            </div>

            <div>
              <label className={labelClass}>Telefone</label>
              <input name="phone" defaultValue={student.phone ?? ""} className={inputClass} />
            </div>

            <div className="col-span-2">
              <label className={labelClass}>E-mail</label>
              <input
                name="email"
                type="email"
                defaultValue={student.email ?? ""}
                className={inputClass}
              />
            </div>

            {enrollment && (
              <>
                <div>
                  <label className={labelClass}>Plano</label>
                  <select name="planId" required defaultValue={enrollment.plan_id} className={inputClass}>
                    {plans.map((plan) => (
                      <option key={plan.id} value={plan.id}>
                        {plan.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className={labelClass}>Professor</label>
                  <select
                    name="teacherId"
                    defaultValue={enrollment.teacher_id ?? ""}
                    className={inputClass}
                  >
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
                  <input
                    name="monthlyValue"
                    type="number"
                    step="0.01"
                    required
                    defaultValue={enrollment.monthly_value}
                    className={inputClass}
                  />
                </div>

                <div>
                  <label className={labelClass}>Dia de vencimento</label>
                  <input
                    name="dueDay"
                    type="number"
                    min={1}
                    max={28}
                    required
                    defaultValue={enrollment.due_day}
                    className={inputClass}
                  />
                </div>
              </>
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
              {pending ? "Salvando..." : "Salvar"}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
