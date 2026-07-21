"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import {
  createCashTransaction,
  createCostCategory,
  type CashTransactionState,
} from "@/app/actions/cash-transactions";

type CostCategory = { id: string; name: string; type: string };

const inputClass =
  "mt-1 w-full rounded-md border border-ink-700 bg-ink-950 px-3 py-2 text-ink-50 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500";
const labelClass = "block text-sm font-medium text-ink-100";

export function NewTransactionForm({ categories }: { categories: CostCategory[] }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const newCategoryDialogRef = useRef<HTMLDialogElement>(null);
  const [state, action, pending] = useActionState<CashTransactionState, FormData>(
    createCashTransaction,
    undefined
  );

  const [categoryOptions, setCategoryOptions] = useState(categories);
  const [selectedCategoryId, setSelectedCategoryId] = useState("");
  const [newCategoryError, setNewCategoryError] = useState<string | null>(null);
  const [creatingCategory, setCreatingCategory] = useState(false);

  useEffect(() => {
    if (state?.success) {
      dialogRef.current?.close();
    }
  }, [state]);

  async function handleCreateCategory(formData: FormData) {
    setCreatingCategory(true);
    setNewCategoryError(null);
    const result = await createCostCategory(formData);
    setCreatingCategory(false);
    if (!result.success) {
      setNewCategoryError(result.error);
      return;
    }
    setCategoryOptions((prev) => [...prev, result.category]);
    setSelectedCategoryId(result.category.id);
    newCategoryDialogRef.current?.close();
  }

  return (
    <>
      <button
        onClick={() => dialogRef.current?.showModal()}
        className="rounded-md bg-gradient-to-b from-amber-300 to-amber-500 px-4 py-2 text-sm font-semibold text-ink-950 glow-amber transition hover:brightness-105"
      >
        + Novo lançamento
      </button>

      <dialog
        ref={dialogRef}
        className="card-premium w-full max-w-lg rounded-lg p-0 text-ink-50 backdrop:bg-black/70"
      >
        <form action={action} className="space-y-4 p-6">
          <h2 className="font-display text-lg font-bold text-ink-50">Novo lançamento</h2>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>Tipo</label>
              <select name="type" required className={inputClass}>
                <option value="entrada">Entrada</option>
                <option value="saida">Saída</option>
              </select>
            </div>

            <div>
              <label className={labelClass}>Data</label>
              <input
                name="date"
                type="date"
                required
                defaultValue={new Date().toISOString().slice(0, 10)}
                className={inputClass}
              />
            </div>

            <div className="col-span-2">
              <label className={labelClass}>Descrição</label>
              <input name="description" required className={inputClass} />
              {state?.errors?.description && (
                <p className="mt-1 text-xs text-status-overdue">{state.errors.description[0]}</p>
              )}
            </div>

            <div>
              <label className={labelClass}>Categoria</label>
              <select
                name="categoryId"
                value={selectedCategoryId}
                onChange={(e) => {
                  if (e.target.value === "__new__") {
                    newCategoryDialogRef.current?.showModal();
                    return;
                  }
                  setSelectedCategoryId(e.target.value);
                }}
                className={inputClass}
              >
                <option value="">Sem categoria</option>
                {categoryOptions.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
                <option value="__new__">+ Nova categoria</option>
              </select>
            </div>

            <div>
              <label className={labelClass}>Valor</label>
              <input name="amount" type="number" step="0.01" required className={inputClass} />
              {state?.errors?.amount && (
                <p className="mt-1 text-xs text-status-overdue">{state.errors.amount[0]}</p>
              )}
            </div>

            <div className="col-span-2">
              <label className={labelClass}>Forma de pagamento</label>
              <select name="paymentMethod" className={inputClass}>
                <option value="">—</option>
                <option value="pix">PIX</option>
                <option value="cartao">Cartão</option>
                <option value="boleto">Boleto</option>
                <option value="transferencia">Transferência</option>
              </select>
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
              {pending ? "Salvando..." : "Lançar"}
            </button>
          </div>
        </form>
      </dialog>

      <dialog
        ref={newCategoryDialogRef}
        onClose={() => setSelectedCategoryId((id) => (id === "__new__" ? "" : id))}
        className="card-premium w-full max-w-sm rounded-lg p-0 text-ink-50 backdrop:bg-black/70"
      >
        <form action={handleCreateCategory} className="space-y-4 p-6">
          <h2 className="font-display text-base font-bold text-ink-50">Nova categoria</h2>

          <div>
            <label className={labelClass}>Nome</label>
            <input name="name" required className={inputClass} />
          </div>

          <div>
            <label className={labelClass}>Tipo</label>
            <select name="type" defaultValue="variable" className={inputClass}>
              <option value="fixed">Fixa</option>
              <option value="variable">Variável</option>
            </select>
          </div>

          {newCategoryError && <p className="text-sm text-status-overdue">{newCategoryError}</p>}

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => newCategoryDialogRef.current?.close()}
              className="rounded-md px-4 py-2 text-sm font-medium text-ink-300 hover:text-ink-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={creatingCategory}
              className="rounded-md bg-gradient-to-b from-amber-300 to-amber-500 px-4 py-2 text-sm font-semibold text-ink-950 glow-amber transition hover:brightness-105 disabled:opacity-60"
            >
              {creatingCategory ? "Salvando..." : "Criar"}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
