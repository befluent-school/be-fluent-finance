"use client";

import { useEffect } from "react";
import { reportClientError } from "@/lib/report-client-error";

/** Último recurso (erro no layout raiz): página simples, sem depender do resto do app. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    reportClientError("global", error, error.digest ? `digest=${error.digest}` : undefined);
  }, [error]);

  return (
    <html lang="pt-BR">
      <body style={{ margin: 0, minHeight: "100vh", display: "grid", placeItems: "center", background: "#0b0b0d", color: "#f4f4f5", fontFamily: "system-ui, sans-serif" }}>
        <div style={{ maxWidth: 420, padding: 24, textAlign: "center" }}>
          <p style={{ fontSize: 32, margin: 0 }}>⚠️</p>
          <h1 style={{ fontSize: 18 }}>O sistema teve um problema ao abrir esta página</h1>
          <p style={{ fontSize: 14, color: "#a1a1aa" }}>Seus dados estão salvos. O erro já foi registrado para correção.</p>
          <div style={{ display: "flex", gap: 12, justifyContent: "center", marginTop: 16 }}>
            <button
              type="button"
              onClick={reset}
              style={{ background: "#f0a520", color: "#0b0b0d", border: 0, borderRadius: 6, padding: "8px 16px", fontWeight: 600, cursor: "pointer" }}
            >
              Tentar de novo
            </button>
            <a href="/dashboard" style={{ color: "#d4d4d8", padding: "8px 16px", border: "1px solid #3f3f46", borderRadius: 6, textDecoration: "none" }}>
              Ir para o Dashboard
            </a>
          </div>
        </div>
      </body>
    </html>
  );
}
