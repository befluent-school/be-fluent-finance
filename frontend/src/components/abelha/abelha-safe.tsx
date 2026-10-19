"use client";

import { ErrorBoundary } from "@/components/error-boundary";
import { AbelhaWidget } from "./abelha-widget";

const STORAGE_KEY = "abelha:conversa:v2";

/** A Abelha nunca derruba a página: se quebrar, reinicia só ela. */
export function AbelhaSafe() {
  return (
    <ErrorBoundary
      name="abelha"
      onError={() => {
        // Uma conversa salva corrompida não pode quebrar de novo ao reabrir.
        try {
          localStorage.removeItem(STORAGE_KEY);
        } catch {
          /* sem armazenamento */
        }
      }}
      fallback={(reset) => (
        <button
          type="button"
          onClick={reset}
          className="fixed bottom-4 right-4 z-40 rounded-full bg-ink-900 px-4 py-3 text-xs text-ink-100 shadow-lg ring-1 ring-amber-500/50 md:bottom-6 md:right-6"
        >
          🐝 A Abelha teve um problema e foi reiniciada. Toque para abrir de novo.
        </button>
      )}
    >
      <AbelhaWidget />
    </ErrorBoundary>
  );
}
