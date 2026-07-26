"use client";

import { useState, useTransition } from "react";
import { deleteInvoice } from "@/app/actions/invoices";

export function DeleteInvoiceButton({ invoiceId }: { invoiceId: string }) {
  const [isPending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (confirming) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs text-ink-300">Confirma?</span>
        <button
          disabled={isPending}
          onClick={() => {
            startTransition(async () => {
              const res = await deleteInvoice(invoiceId);
              if (res?.error) {
                setError(res.error);
                setConfirming(false);
              }
            });
          }}
          className="rounded-md bg-status-overdue/15 px-2 py-1 text-xs font-semibold text-status-overdue hover:bg-status-overdue/25"
        >
          {isPending ? "..." : "Sim"}
        </button>
        <button
          onClick={() => setConfirming(false)}
          className="rounded-md px-2 py-1 text-xs text-ink-300 hover:text-ink-50"
        >
          Não
        </button>
      </div>
    );
  }

  return (
    <div>
      <button
        onClick={() => setConfirming(true)}
        className="rounded-md px-2 py-1 text-xs text-ink-500 hover:text-status-overdue"
      >
        Excluir
      </button>
      {error && <p className="mt-1 text-xs text-status-overdue">{error}</p>}
    </div>
  );
}
