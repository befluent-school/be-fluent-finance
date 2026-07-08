"use client";

import { useActionState, useRef } from "react";
import { markInvoicePaid, type MarkPaidState } from "@/app/actions/invoices";

const inputClass =
  "mt-1 w-full rounded-md border border-ink-700 bg-ink-950 px-3 py-2 text-ink-50 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500";

export function MarkPaidForm({ invoiceId }: { invoiceId: string }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [state, action, pending] = useActionState<MarkPaidState, FormData>(
    markInvoicePaid,
    undefined
  );

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

          <div>
            <label className="block text-sm font-medium text-ink-100">Data do pagamento</label>
            <input
              name="paidDate"
              type="date"
              required
              defaultValue={new Date().toISOString().slice(0, 10)}
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
