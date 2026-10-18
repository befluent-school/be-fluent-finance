"use client";

import { useActionState, useState } from "react";
import { formatCurrencyBRL } from "@shared/finance";
import {
  saveTeacherPayment,
  confirmTeacherPayment,
  reopenTeacherPayment,
  type PayrollActionState,
} from "@/app/actions/payroll";
import { suggestAmount, type PayrollRow } from "@/lib/payroll-shared";
import { StatusBadge } from "@/components/ui/status-badge";
import { EditTeacherDialog } from "./edit-teacher-dialog";

const cellInput =
  "w-24 rounded-md border border-ink-700 bg-ink-950 px-2 py-1 text-ink-50 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500";

export function PayrollRowEditor({
  row,
  referenceMonth,
  canManage,
  paymentTypeLabel,
}: {
  row: PayrollRow;
  referenceMonth: string; // YYYY-MM-01
  canManage: boolean;
  paymentTypeLabel: string;
}) {
  const [saveState, saveAction, saving] = useActionState<PayrollActionState, FormData>(saveTeacherPayment, undefined);
  const [confirmState, confirmAction, confirming] = useActionState<PayrollActionState, FormData>(
    confirmTeacherPayment,
    undefined,
  );
  const [reopenState, reopenAction, reopening] = useActionState<PayrollActionState, FormData>(
    reopenTeacherPayment,
    undefined,
  );

  const confirmed = row.status === "confirmado";
  const isAuto = row.payment_type !== "outro";

  const [lessons, setLessons] = useState(row.lessons_given);
  const [finalAmount, setFinalAmount] = useState(
    row.final_amount || row.suggested_amount || (row.status === "sem_folha" ? suggestAmount(row.payment_type, row.payment_reference_value, row.lessons_given, row.student_revenue) : 0),
  );

  const liveSuggested = suggestAmount(row.payment_type, row.payment_reference_value, lessons, row.student_revenue);

  // Ao mudar as aulas numa regra automática (por hora/fixo), alinhamos o
  // "a pagar" ao sugerido no mesmo evento (sem useEffect → sem cascata de
  // renders). O usuário ainda pode sobrescrever o valor manualmente depois.
  function onLessonsChange(next: number) {
    setLessons(next);
    if (isAuto) setFinalAmount(suggestAmount(row.payment_type, row.payment_reference_value, next, row.student_revenue));
  }

  const err = saveState?.message || confirmState?.message || reopenState?.message;

  return (
    <>
      <tr className="border-b border-ink-700/70 last:border-0 hover:bg-white/[0.03]">
        <td className="px-4 py-3 text-ink-50">
          <div className="flex items-center gap-1.5">
            <span>{row.full_name}</span>
            {canManage && <EditTeacherDialog row={row} />}
          </div>
          <p className="text-xs text-ink-500">{row.active_students} aluno(s) ativo(s)</p>
        </td>
        <td className="px-4 py-3 text-ink-300">
          <span>{paymentTypeLabel}</span>
          {row.payment_reference_value != null && row.payment_type !== "repasse_integral" && (
            <span className="text-ink-500">
              {" · "}
              {row.payment_type === "comissao"
                ? `${row.payment_reference_value.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`
                : formatCurrencyBRL(row.payment_reference_value)}
            </span>
          )}
          {(row.payment_type === "comissao" || row.payment_type === "repasse_integral") && (
            <p className="text-xs text-ink-500">Alunos pagaram {formatCurrencyBRL(row.student_revenue)} no mês</p>
          )}
        </td>
        <td className="px-4 py-3">
          {canManage && !confirmed ? (
            <input
              type="number"
              min={0}
              value={lessons}
              onChange={(e) => onLessonsChange(Number(e.target.value) || 0)}
              className={cellInput}
            />
          ) : (
            <span className="font-tabular text-ink-300">{row.lessons_given}</span>
          )}
        </td>
        <td className="font-tabular px-4 py-3 text-ink-400">{formatCurrencyBRL(confirmed ? row.suggested_amount : liveSuggested)}</td>
        <td className="px-4 py-3">
          {canManage && !confirmed ? (
            <input
              type="number"
              step="0.01"
              min={0}
              value={finalAmount}
              onChange={(e) => setFinalAmount(Number(e.target.value) || 0)}
              className={`${cellInput} w-28`}
            />
          ) : (
            <span className="font-tabular font-semibold text-ink-50">{formatCurrencyBRL(row.final_amount)}</span>
          )}
        </td>
        <td className="px-4 py-3">
          <StatusBadge status={row.status === "sem_folha" ? "pendente" : row.status === "confirmado" ? "pago" : "pendente"} />
        </td>
        {canManage && (
          <td className="px-4 py-3">
            <div className="flex items-center justify-end gap-2">
              {!confirmed ? (
                <>
                  <form action={saveAction}>
                    <input type="hidden" name="teacherId" value={row.teacher_id} />
                    <input type="hidden" name="referenceMonth" value={referenceMonth} />
                    <input type="hidden" name="lessonsGiven" value={lessons} />
                    <input type="hidden" name="finalAmount" value={finalAmount} />
                    <button
                      type="submit"
                      disabled={saving}
                      className="rounded-md px-3 py-1 text-xs text-ink-300 ring-1 ring-inset ring-ink-700 hover:text-ink-50 disabled:opacity-60"
                    >
                      {saving ? "…" : "Salvar"}
                    </button>
                  </form>
                  <form action={confirmAction}>
                    <input type="hidden" name="paymentId" value={row.payment_id ?? ""} />
                    <button
                      type="submit"
                      disabled={confirming || !row.payment_id}
                      title={!row.payment_id ? "Salve a folha antes de confirmar." : "Confirmar e gerar conta a pagar"}
                      className="rounded-md bg-gradient-to-b from-amber-300 to-amber-500 px-3 py-1 text-xs font-semibold text-ink-950 disabled:opacity-40"
                    >
                      {confirming ? "…" : "Confirmar"}
                    </button>
                  </form>
                </>
              ) : (
                <form action={reopenAction}>
                  <input type="hidden" name="paymentId" value={row.payment_id ?? ""} />
                  <button
                    type="submit"
                    disabled={reopening}
                    className="rounded-md px-3 py-1 text-xs text-ink-300 ring-1 ring-inset ring-ink-700 hover:text-ink-50 disabled:opacity-60"
                  >
                    {reopening ? "…" : "Reabrir"}
                  </button>
                </form>
              )}
            </div>
          </td>
        )}
      </tr>
      {err && (
        <tr>
          <td colSpan={canManage ? 7 : 6} className="px-4 pb-2 text-xs text-status-overdue">
            {err}
          </td>
        </tr>
      )}
    </>
  );
}
