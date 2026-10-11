"use client";

import { useState, useTransition } from "react";
import { toggleRecurringPayable, deleteRecurringPayable } from "@/app/actions/recurring-payables";

export function RecurringRowActions({ id, active }: { id: string; active: boolean }) {
  const [isPending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex items-center gap-3">
      <button
        disabled={isPending}
        onClick={() => startTransition(async () => {
          const res = await toggleRecurringPayable(id, !active);
          if (res?.error) setError(res.error);
        })}
        className={`rounded-md px-2 py-1 text-xs font-semibold ${active ? "bg-status-paid-bg text-status-paid" : "bg-ink-800 text-ink-400"}`}
      >
        {active ? "Ativa" : "Inativa"}
      </button>

      {confirming ? (
        <span className="flex items-center gap-2">
          <button
            disabled={isPending}
            onClick={() => startTransition(async () => {
              const res = await deleteRecurringPayable(id);
              if (res?.error) { setError(res.error); setConfirming(false); }
            })}
            className="rounded-md bg-status-overdue/15 px-2 py-1 text-xs font-semibold text-status-overdue"
          >
            {isPending ? "..." : "Confirmar"}
          </button>
          <button onClick={() => setConfirming(false)} className="text-xs text-ink-300 hover:text-ink-50">Cancelar</button>
        </span>
      ) : (
        <button onClick={() => setConfirming(true)} className="text-xs text-ink-500 hover:text-status-overdue">Excluir</button>
      )}
      {error && <span className="text-xs text-status-overdue">{error}</span>}
    </div>
  );
}
