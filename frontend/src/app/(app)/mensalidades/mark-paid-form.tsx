"use client";

import { useActionState, useRef, useState } from "react";
import { markInvoicePaid, type MarkPaidState } from "@/app/actions/invoices";
import { calculateLateFee, formatCurrencyBRL } from "@shared/finance";

const inputClass =
  "mt-1 w-full rounded-md border border-ink-700 bg-ink-950 px-3 py-2 text-ink-50 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500";

export function MarkPaidForm({
  invoiceId,
  amount,
  dueDate,
}: {
  invoiceId: string;
  amount: number;
  dueDate: string;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [state, action, pending] = useActionState<MarkPaidState, FormData>(
    markInvoicePaid,
    undefined
  );

  const today = new Date().toISOString().slice(0, 10);
  const [paidDate, setPaidDate] = useState(today);
  const suggested = calculateLateFee(amount, dueDate, paidDate);
  const [lateFee, setLateFee] = useState(suggested.lateFee);
  const [interest, setInterest] = useState(suggested.interest);

  function handlePaidDateChange(value: string) {
    setPaidDate(value);
    const recalculated = calculateLateFee(amount, dueDate, value);
    setLateFee(recalculated.lateFee);
    setInterest(recalculated.interest);
  }

  const total = amount + lateFee + interest;
  const isLate = lateFee > 0 || interest > 0;

  return (
    <>
      <button
        onClick={() => dialogRef.current?.showModal()}
        className="rounded-md bg-amber-500/15 px-3 py-1 text-xs font-semibold text-amber-300 transition hover:bg-amber-500/25"
      >
        Registrar pagamento
      </button>

      <dialog
        ref={dialogRef}
        className="card-premium w-full max-w-sm rounded-lg p-0 text-ink-50 backdrop:bg-black/70"
      >
        <form action={action} className="space-y-4 p-6">
          <h2 className="font-display text-base font-bold text-ink-50">Registrar pagamento</h2>
          <input type="hidden" name="invoiceId" value={invoiceId} />
          <input type="hidden" name="lateFeeAmount" value={lateFee} />
          <input type="hidden" name="interestAmount" value={interest} />

          <div>
            <label className="block text-sm font-medium text-ink-100">Data do pagamento</label>
            <input
              name="paidDate"
              type="date"
              required
              value={paidDate}
              onChange={(e) => handlePaidDateChange(e.target.value)}
              className={inputClass}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-ink-100">Forma de pagamento</label>
            <select name="paymentMethod" required className={inputClass}>
              <option value="pix">PIX</option>
              <option value="cartao">Cartão</option>
              <option value="boleto">Boleto</option>
              <option value="transferencia">Transferência</option>
            </select>
          </div>

          {isLate && (
            <div className="rounded-md border border-status-overdue/30 bg-status-overdue-bg p-3">
              <p className="text-xs font-semibold text-status-overdue">
                Pagamento em atraso — multa (10%) e juros (1%/mês) sugeridos, editáveis:
              </p>
              <div className="mt-2 grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-ink-300">Multa (R$)</label>
                  <input
                    type="number"
                    step="0.01"
                    min={0}
                    value={lateFee}
                    onChange={(e) => setLateFee(Number(e.target.value) || 0)}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className="block text-xs text-ink-300">Juros (R$)</label>
                  <input
                    type="number"
                    step="0.01"
                    min={0}
                    value={interest}
                    onChange={(e) => setInterest(Number(e.target.value) || 0)}
                    className={inputClass}
                  />
                </div>
              </div>
            </div>
          )}

          <div className="flex items-baseline justify-between border-t border-ink-700 pt-3">
            <span className="text-sm text-ink-300">Total a receber</span>
            <span className="font-tabular text-lg font-bold text-ink-50">
              {formatCurrencyBRL(total)}
            </span>
          </div>

          {state?.error && <p className="text-sm text-status-overdue">{state.error}</p>}

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
              {pending ? "Salvando..." : "Confirmar"}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
