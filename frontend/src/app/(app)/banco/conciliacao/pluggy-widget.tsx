"use client";

import { useState } from "react";
import { PluggyConnect } from "react-pluggy-connect";
import { registerBankConnection } from "@/app/actions/bank";

export default function PluggyWidget({
  connectToken,
  onClose,
}: {
  connectToken: string;
  onClose: () => void;
}) {
  const [error, setError] = useState<string | null>(null);

  if (error) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
        <div className="card-premium w-full max-w-sm rounded-lg p-6 text-ink-50">
          <p className="text-sm font-semibold text-status-overdue">Erro ao conectar</p>
          <p className="mt-2 text-sm text-ink-300">{error}</p>
          <button
            onClick={onClose}
            className="mt-4 rounded-md bg-gradient-to-b from-amber-300 to-amber-500 px-4 py-2 text-sm font-semibold text-ink-950 hover:brightness-105"
          >
            Fechar
          </button>
        </div>
      </div>
    );
  }

  return (
    <PluggyConnect
      connectToken={connectToken}
      includeSandbox={process.env.NODE_ENV !== "production"}
      onSuccess={async ({ item }) => {
        const result = await registerBankConnection(item.id, item.connector?.name ?? "Banco");
        if (result?.error) {
          setError(result.error);
          return;
        }
        onClose();
      }}
      onError={onClose}
      onClose={onClose}
    />
  );
}
