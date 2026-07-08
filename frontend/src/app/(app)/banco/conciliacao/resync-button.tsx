"use client";

import { useState, useTransition } from "react";
import { resyncBankConnection } from "@/app/actions/bank";

export function ResyncButton({ connectionId }: { connectionId: string }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div>
      <button
        disabled={isPending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const result = await resyncBankConnection(connectionId);
            if (result?.error) setError(result.error);
          });
        }}
        className="rounded-md bg-white/[0.06] px-3 py-1 text-xs font-semibold text-ink-100 hover:bg-white/[0.1] disabled:opacity-60"
      >
        {isPending ? "Sincronizando..." : "Sincronizar novamente"}
      </button>
      {error && <p className="mt-1 max-w-xs text-xs text-status-overdue">{error}</p>}
    </div>
  );
}
