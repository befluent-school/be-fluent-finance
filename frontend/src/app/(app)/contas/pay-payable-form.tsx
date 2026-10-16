"use client";

import { todayBR } from "@/lib/dates";
import { useActionState, useRef, useState } from "react";
import { markPayablePaid, type MarkPayablePaidState } from "@/app/actions/payables";
import { formatCurrencyBRL } from "@shared/finance";

const inputClass =
  "mt-1 w-full rounded-md border border-ink-700 bg-ink-950 px-3 py-2 text-ink-50 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500";

export function PayPayableForm({ payableId, amount }: { payableId: string; amount: number }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [state, action, pending] = useActionState<MarkPayablePaidState, FormData>(markPayablePaid, undefined);
  const today = todayBR();
  const [total, setTotal] = useState(amount);

  return (
    <>
      <button
        onClick={() => dialogRef.current?.showModal()}
        className="rounded-md bg-amber-500/15 px-3 py-1 text-xs font-semibold text-amber-300 transition hover:bg-amber-500/25"
      >
        Registrar pagamento
      </button>

      <dialog ref={dialogRef} className="card-premium w-full max-w-sm rounded-lg p-0 text-ink-50 backdrop:bg-black/70">
        <form action={action} className="space-y-4 p-6">
          <h2 className="font-display text-base font-bold">Registrar pagamento</h2>
          <input type="hidden" name="payableId" value={payableId} />
          <input type="hidden" name="totalPaid" value={total} />

          <div>
            <label className="block text-sm font-medium text-ink-100">Data do pagamento</label>
            <input name="paidDate" type="date" required defaultValue={today} className={inputClass} />
          </div>
          <div>
            <label className="block text-sm font-medium text-ink-100">Forma de pagamento</label>
            <select name="paymentMethod" required className={inputClass}>
              <option value="pix">PIX</option>
              <option value="boleto">Boleto</option>
              <option value="transferencia">Transferência</option>
              <option value="cartao">Cartão</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-ink-100">Valor pago (R$)</label>
            <input
              type="number"
              step="0.01"
              min={0}
              value={total}
              onChange={(e) => setTotal(Number(e.target.value) || 0)}
              className={inputClass}
            />
          </div>

          <div className="flex items-baseline justify-between border-t border-ink-700 pt-3">
            <span className="text-sm text-ink-300">Total a pagar</span>
            <span className="font-tabular text-lg font-bold">{formatCurrencyBRL(total)}</span>
          </div>

          {state?.error && <p className="text-sm text-status-overdue">{state.error}</p>}

          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={() => dialogRef.current?.close()} className="rounded-md px-4 py-2 text-sm font-medium text-ink-300 hover:text-ink-50">
              Cancelar
            </button>
            <button type="submit" disabled={pending} className="rounded-md bg-gradient-to-b from-amber-300 to-amber-500 px-4 py-2 text-sm font-semibold text-ink-950 glow-amber transition hover:brightness-105 disabled:opacity-60">
              {pending ? "Salvando..." : "Confirmar"}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
