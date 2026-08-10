"use client";

import { useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";

export function BancoTabs({
  importTab,
  extratoTab,
}: {
  importTab: ReactNode;
  extratoTab: ReactNode;
}) {
  const searchParams = useSearchParams();
  const hasExtratoFilters = ["de", "ate", "tipo", "pagina"].some((key) => searchParams.has(key));
  const [tab, setTab] = useState<"importar" | "extrato">(hasExtratoFilters ? "extrato" : "importar");

  return (
    <div>
      <div className="mt-4 flex gap-4 border-b border-ink-700 text-sm">
        <button
          onClick={() => setTab("importar")}
          className={`border-b-2 px-1 pb-2 font-semibold transition ${
            tab === "importar" ? "border-amber-500 text-ink-50" : "border-transparent text-ink-300 hover:text-ink-50"
          }`}
        >
          Importar
        </button>
        <button
          onClick={() => setTab("extrato")}
          className={`border-b-2 px-1 pb-2 font-semibold transition ${
            tab === "extrato" ? "border-amber-500 text-ink-50" : "border-transparent text-ink-300 hover:text-ink-50"
          }`}
        >
          Extrato completo
        </button>
      </div>

      <div className={tab === "importar" ? "mt-6" : "hidden"}>{importTab}</div>
      <div className={tab === "extrato" ? "mt-6" : "hidden"}>{extratoTab}</div>
    </div>
  );
}
