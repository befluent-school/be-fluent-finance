"use client";

import { useState } from "react";
import { reconcileTransaction, ignoreStagingTransaction } from "@/app/actions/reconciliation";

type CostCategory = { id: string; name: string };

export function ReconcileForm({
  stagingId,
  description,
  categories,
}: {
  stagingId: string;
  description: string;
  categories: CostCategory[];
}) {
  const [createRule, setCreateRule] = useState(false);

  return (
    <form action={reconcileTransaction} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="stagingId" value={stagingId} />
      <select
        name="categoryId"
        required
        className="rounded-md border border-ink-700 bg-ink-950 px-2 py-1 text-xs text-ink-50 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
      >
        <option value="">Categoria</option>
        {categories.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>

      <label className="flex items-center gap-1 text-xs text-ink-300">
        <input
          type="checkbox"
          checked={createRule}
          onChange={(e) => setCreateRule(e.target.checked)}
          name="createRule"
          className="accent-amber-500"
        />
        Sempre categorizar assim
      </label>

      {createRule && (
        <input type="hidden" name="keyword" value={description.split(" ")[0]} />
      )}

      <button
        type="submit"
        className="rounded-md bg-status-paid-bg px-3 py-1 text-xs font-semibold text-status-paid hover:bg-status-paid-bg/70"
      >
        Confirmar
      </button>

      <button
        type="submit"
        formAction={ignoreStagingTransaction}
        className="rounded-md px-3 py-1 text-xs font-medium text-ink-500 hover:text-ink-300"
      >
        Ignorar
      </button>
    </form>
  );
}
