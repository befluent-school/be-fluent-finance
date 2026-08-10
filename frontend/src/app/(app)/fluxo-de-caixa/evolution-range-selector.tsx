"use client";

import { useRouter, useSearchParams } from "next/navigation";

const OPTIONS = [
  { value: "6m", label: "6 meses" },
  { value: "12m", label: "12 meses" },
  { value: "ano", label: "Ano civil" },
] as const;

export function EvolutionRangeSelector() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const current = searchParams.get("evolucao") ?? "6m";

  function applyRange(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value === "6m") {
      params.delete("evolucao");
    } else {
      params.set("evolucao", value);
    }
    const query = params.toString();
    router.push(`/fluxo-de-caixa${query ? `?${query}` : ""}`);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {OPTIONS.map((opt) => (
        <button
          key={opt.value}
          onClick={() => applyRange(opt.value)}
          className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
            current === opt.value
              ? "bg-amber-500/15 text-amber-300"
              : "bg-white/[0.06] text-ink-100 hover:bg-white/[0.1]"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
