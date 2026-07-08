"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { getPluggyConnectToken } from "@/app/actions/bank";

// O SDK da Pluggy acessa `window` na avaliação do módulo, então precisa
// ficar fora do bundle de SSR — só carrega no client, quando o token existe.
const PluggyWidget = dynamic(() => import("./pluggy-widget"), { ssr: false });

export function ConnectBankButton() {
  const [connectToken, setConnectToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleOpen() {
    setLoading(true);
    setError(null);
    try {
      const token = await getPluggyConnectToken();
      setConnectToken(token);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Não foi possível iniciar a conexão bancária. Tente novamente."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <button
        onClick={handleOpen}
        disabled={loading}
        className="rounded-md bg-gradient-to-b from-amber-300 to-amber-500 px-4 py-2 text-sm font-semibold text-ink-950 glow-amber transition hover:brightness-105 disabled:opacity-60"
      >
        {loading ? "Preparando..." : "+ Conectar conta bancária"}
      </button>

      {error && <p className="mt-2 max-w-sm text-xs text-status-overdue">{error}</p>}

      {connectToken && (
        <PluggyWidget connectToken={connectToken} onClose={() => setConnectToken(null)} />
      )}
    </div>
  );
}
