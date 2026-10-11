"use client";

import { useActionState, useEffect, useRef } from "react";
import { createBankProvider, type ProviderFormState } from "@/app/actions/bank-providers";

const inputClass =
  "mt-1 w-full rounded-md border border-ink-700 bg-ink-950 px-3 py-2 text-ink-50 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500";

export function NewProviderForm() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [state, action, pending] = useActionState<ProviderFormState, FormData>(createBankProvider, undefined);

  useEffect(() => {
    if (state?.success) dialogRef.current?.close();
  }, [state]);

  return (
    <>
      <button
        onClick={() => dialogRef.current?.showModal()}
        className="rounded-md bg-gradient-to-b from-amber-300 to-amber-500 px-4 py-2 text-sm font-semibold text-ink-950 glow-amber transition hover:brightness-105"
      >
        Nova conexão
      </button>

      <dialog ref={dialogRef} className="card-premium w-full max-w-md rounded-lg p-0 text-ink-50 backdrop:bg-black/70">
        <form action={action} className="space-y-4 p-6">
          <h2 className="font-display text-base font-bold">Nova conexão bancária</h2>

          <div>
            <label className="block text-sm font-medium text-ink-100">Banco / provedor</label>
            <select name="provider" className={inputClass} defaultValue="asaas">
              <option value="asaas">ASAAS</option>
              <option value="inter">Banco Inter (PJ)</option>
              <option value="generic_api">Outro (API genérica)</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-ink-100">Rótulo (aparece no fluxo de caixa)</label>
            <input name="label" required className={inputClass} placeholder="Ex.: Inter PJ" />
            {state?.errors?.label && <p className="mt-1 text-xs text-status-overdue">{state.errors.label[0]}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium text-ink-100">Buscar quantos dias para trás a cada sync</label>
            <input name="syncWindowDays" type="number" min={1} max={90} defaultValue={35} className={inputClass} />
          </div>

          {state?.message && <p className="text-sm text-status-overdue">{state.message}</p>}

          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={() => dialogRef.current?.close()} className="rounded-md px-4 py-2 text-sm font-medium text-ink-300 hover:text-ink-50">Cancelar</button>
            <button type="submit" disabled={pending} className="rounded-md bg-gradient-to-b from-amber-300 to-amber-500 px-4 py-2 text-sm font-semibold text-ink-950 glow-amber transition hover:brightness-105 disabled:opacity-60">
              {pending ? "Criando..." : "Criar"}
            </button>
          </div>
          <p className="text-xs text-ink-500">Depois de criar, abra a conexão para colar as credenciais.</p>
        </form>
      </dialog>
    </>
  );
}
