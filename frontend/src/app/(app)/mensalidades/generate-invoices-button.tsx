"use client";

import { useTransition } from "react";
import { generateMonthlyInvoices } from "@/app/actions/invoices";

export function GenerateInvoicesButton({ referenceMonth }: { referenceMonth: string }) {
  const [isPending, startTransition] = useTransition();

  return (
    <button
      onClick={() =>
        startTransition(async () => {
          await generateMonthlyInvoices(referenceMonth);
        })
      }
      disabled={isPending}
      className="rounded-md bg-gradient-to-b from-amber-300 to-amber-500 px-4 py-2 text-sm font-semibold text-ink-950 glow-amber transition hover:brightness-105 disabled:opacity-60"
    >
      {isPending ? "Gerando..." : "Gerar mensalidades do mês"}
    </button>
  );
}
