"use client";

import { useState, useTransition } from "react";
import { deleteStudent } from "@/app/actions/students";

export function DeleteStudentButton({ studentId, studentName }: { studentId: string; studentName: string }) {
  const [isPending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (confirming) {
    return (
      <div className="flex flex-col items-end gap-2">
        <p className="max-w-xs text-right text-xs text-status-overdue">
          Excluir {studentName} apaga também todo o histórico de mensalidades dele. Essa ação não
          pode ser desfeita.
        </p>
        <div className="flex items-center gap-2">
          <button
            disabled={isPending}
            onClick={() => {
              startTransition(async () => {
                const res = await deleteStudent(studentId);
                if (res?.error) {
                  setError(res.error);
                  setConfirming(false);
                }
              });
            }}
            className="rounded-md bg-status-overdue/15 px-3 py-1.5 text-xs font-semibold text-status-overdue hover:bg-status-overdue/25"
          >
            {isPending ? "Excluindo..." : "Sim, excluir"}
          </button>
          <button
            onClick={() => setConfirming(false)}
            className="rounded-md px-3 py-1.5 text-xs text-ink-300 hover:text-ink-50"
          >
            Cancelar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <button
        onClick={() => setConfirming(true)}
        className="rounded-md bg-white/[0.06] px-3 py-1.5 text-xs font-semibold text-status-overdue hover:bg-status-overdue/15"
      >
        Excluir aluno
      </button>
      {error && <p className="mt-1 text-xs text-status-overdue">{error}</p>}
    </div>
  );
}
