"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { createTask, updateTask, type TaskState } from "@/app/actions/tasks";

type TaskRow = {
  id: string;
  title: string;
  description: string | null;
  due_date: string;
  priority: "alta" | "media" | "baixa";
  assignee_id: string | null;
  recurrence: "none" | "daily" | "weekly" | "monthly";
};

type ProfileOption = { id: string; full_name: string };

const inputClass =
  "mt-1 w-full rounded-md border border-ink-700 bg-ink-950 px-3 py-2 text-ink-50 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500";
const labelClass = "block text-sm font-medium text-ink-100";

export function TaskForm({
  task,
  profiles,
  defaultDueDate,
  trigger,
}: {
  task?: TaskRow;
  profiles: ProfileOption[];
  defaultDueDate?: string;
  trigger?: React.ReactNode;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const isEdit = Boolean(task);
  const [state, action, pending] = useActionState<TaskState, FormData>(
    isEdit ? updateTask : createTask,
    undefined
  );
  const [isFixed, setIsFixed] = useState((task?.recurrence ?? "none") !== "none");

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
        {trigger ?? "+ Nova tarefa"}
      </button>

      <dialog
        ref={dialogRef}
        className="card-premium w-full max-w-md rounded-lg p-0 text-ink-50 backdrop:bg-black/70"
      >
        <form action={action} className="space-y-4 p-6">
          <h2 className="font-display text-lg font-bold text-ink-50">
            {isEdit ? "Editar tarefa" : "Nova tarefa"}
          </h2>

          {isEdit && <input type="hidden" name="id" value={task!.id} />}

          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className={labelClass}>Título</label>
              <input name="title" required defaultValue={task?.title} className={inputClass} />
              {state?.errors?.title && (
                <p className="mt-1 text-xs text-status-overdue">{state.errors.title[0]}</p>
              )}
            </div>

            <div className="col-span-2">
              <label className={labelClass}>Descrição (opcional)</label>
              <textarea
                name="description"
                defaultValue={task?.description ?? ""}
                rows={2}
                className={inputClass}
              />
            </div>

            <div>
              <label className={labelClass}>Data</label>
              <input
                name="dueDate"
                type="date"
                required
                defaultValue={task?.due_date ?? defaultDueDate}
                className={inputClass}
              />
              {state?.errors?.dueDate && (
                <p className="mt-1 text-xs text-status-overdue">{state.errors.dueDate[0]}</p>
              )}
            </div>

            <div>
              <label className={labelClass}>Prioridade</label>
              <select name="priority" defaultValue={task?.priority ?? "media"} className={inputClass}>
                <option value="alta">Alta</option>
                <option value="media">Média</option>
                <option value="baixa">Baixa</option>
              </select>
            </div>

            <div>
              <label className={labelClass}>Responsável</label>
              <select
                name="assigneeId"
                defaultValue={task?.assignee_id ?? ""}
                className={inputClass}
              >
                <option value="">Sem responsável</option>
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.full_name}
                  </option>
                ))}
              </select>
            </div>

            <div className="col-span-2">
              <label className={labelClass}>Essa atividade é fixa ou variável?</label>
              <div className="mt-1 flex gap-2">
                <button
                  type="button"
                  onClick={() => setIsFixed(false)}
                  className={`flex-1 rounded-md border px-3 py-2 text-sm font-medium transition ${
                    !isFixed
                      ? "border-amber-500 bg-amber-500/15 text-amber-300"
                      : "border-ink-700 text-ink-300 hover:text-ink-50"
                  }`}
                >
                  Variável (uma vez)
                </button>
                <button
                  type="button"
                  onClick={() => setIsFixed(true)}
                  className={`flex-1 rounded-md border px-3 py-2 text-sm font-medium transition ${
                    isFixed
                      ? "border-amber-500 bg-amber-500/15 text-amber-300"
                      : "border-ink-700 text-ink-300 hover:text-ink-50"
                  }`}
                >
                  Fixa (repete)
                </button>
              </div>
            </div>

            {isFixed && (
              <div className="col-span-2">
                <label className={labelClass}>Repete a cada</label>
                <select
                  name="recurrence"
                  defaultValue={task?.recurrence !== "none" ? task?.recurrence : "daily"}
                  className={inputClass}
                >
                  <option value="daily">Dia</option>
                  <option value="weekly">Semana</option>
                  <option value="monthly">Mês</option>
                </select>
              </div>
            )}
            {!isFixed && <input type="hidden" name="recurrence" value="none" />}
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
              {pending ? "Salvando..." : isEdit ? "Salvar" : "Criar"}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
