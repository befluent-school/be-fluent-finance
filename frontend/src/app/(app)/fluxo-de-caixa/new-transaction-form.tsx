"use client";

import { todayBR } from "@/lib/dates";
import { useActionState, useEffect, useRef, useState } from "react";
import {
  createCashTransaction,
  updateCashTransaction,
  createCostCategory,
  type CashTransactionState,
} from "@/app/actions/cash-transactions";
import { suggestRulePattern } from "@/lib/rule-pattern";

type CostCategory = { id: string; name: string; type: string };

type ExistingTransaction = {
  id: string;
  date: string;
  description: string;
  category_id: string | null;
  amount: number;
  type: "entrada" | "saida";
  payment_method: string | null;
  source?: string;
};

const inputClass =
  "mt-1 w-full rounded-md border border-ink-700 bg-ink-950 px-3 py-2 text-ink-50 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500";
const labelClass = "block text-sm font-medium text-ink-100";

export function NewTransactionForm({
  categories,
  transaction,
  trigger,
}: {
  categories: CostCategory[];
  transaction?: ExistingTransaction;
  trigger?: React.ReactNode;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const newCategoryDialogRef = useRef<HTMLDialogElement>(null);
  const isEdit = Boolean(transaction);
  const [state, action, pending] = useActionState<CashTransactionState, FormData>(
    isEdit ? updateCashTransaction : createCashTransaction,
    undefined
  );

  const [categoryOptions, setCategoryOptions] = useState(categories);
  const [selectedCategoryId, setSelectedCategoryId] = useState(transaction?.category_id ?? "");
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
        className={
          trigger
            ? "contents"
            : "rounded-md bg-gradient-to-b from-amber-300 to-amber-500 px-4 py-2 text-sm font-semibold text-ink-950 glow-amber transition hover:brightness-105"
        }
      >
        {trigger ?? "+ Novo lançamento"}
      </button>

      <dialog
        ref={dialogRef}
        className="card-premium w-full max-w-lg rounded-lg p-0 text-ink-50 backdrop:bg-black/70"
      >
        <form action={action} className="space-y-4 p-6">
          <h2 className="font-display text-lg font-bold text-ink-50">
            {isEdit ? "Editar lançamento" : "Novo lançamento"}
          </h2>

          {isEdit && <input type="hidden" name="id" value={transaction!.id} />}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>Tipo</label>
              <select name="type" required defaultValue={transaction?.type ?? "entrada"} className={inputClass}>
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
                defaultValue={transaction?.date ?? todayBR()}
                className={inputClass}
              />
            </div>

            <div className="col-span-2">
              <label className={labelClass}>Descrição</label>
              <input
                name="description"
                required
                defaultValue={transaction?.description}
                className={inputClass}
              />
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
              <input
                name="amount"
                type="number"
                step="0.01"
                required
                defaultValue={transaction?.amount}
                className={inputClass}
              />
              {state?.errors?.amount && (
                <p className="mt-1 text-xs text-status-overdue">{state.errors.amount[0]}</p>
              )}
            </div>

            <div className="col-span-2">
              <label className={labelClass}>Forma de pagamento</label>
              <select
                name="paymentMethod"
                defaultValue={transaction?.payment_method ?? ""}
                className={inputClass}
              >
                <option value="">—</option>
                <option value="pix">PIX</option>
                <option value="cartao">Cartão</option>
                <option value="boleto">Boleto</option>
                <option value="transferencia">Transferência</option>
              </select>
            </div>
          </div>

          {isEdit && transaction && transaction.source !== "manual" && transaction.source !== "opening" && (
            <div className="rounded-md border border-ink-700 bg-white/[0.02] p-3">
              <label className="flex items-start gap-2 text-sm text-ink-100">
                <input type="checkbox" name="learnRule" className="mt-1" />
                <span>
                  Sempre categorizar assim os lançamentos de{" "}
                  {transaction.type === "entrada" ? "entrada" : "saída"} que contenham:
                </span>
              </label>
              <input
                name="rulePattern"
                defaultValue={suggestRulePattern(transaction.description)}
                className={inputClass}
              />
              <p className="mt-1 text-xs text-ink-500">
                Vale para os lançamentos sem categoria que já existem e para os próximos que chegarem dos bancos.
              </p>
            </div>
          )}

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
              {pending ? "Salvando..." : isEdit ? "Salvar" : "Lançar"}
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
