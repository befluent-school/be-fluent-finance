"use client";

import { todayBR } from "@/lib/dates";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

const SHORTCUTS = [
  { label: "7 dias", days: 7 },
  { label: "1 mês", days: 30 },
  { label: "2 meses", days: 60 },
  { label: "3 meses", days: 90 },
];

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

export function PeriodSelector() {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState(todayBR());

  function applyShortcut(days: number) {
    const de = isoDaysAgo(days);
    const ate = todayBR();
    router.push(`/fluxo-de-caixa?de=${de}&ate=${ate}`);
  }

  function applyCustom() {
    if (!customFrom || !customTo) return;
    router.push(`/fluxo-de-caixa?de=${customFrom}&ate=${customTo}`);
    dialogRef.current?.close();
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {SHORTCUTS.map((s) => (
        <button
          key={s.days}
          onClick={() => applyShortcut(s.days)}
          className="rounded-md bg-white/[0.06] px-3 py-1.5 text-xs font-semibold text-ink-100 hover:bg-white/[0.1]"
        >
          {s.label}
        </button>
      ))}
      <button
        onClick={() => dialogRef.current?.showModal()}
        className="rounded-md bg-white/[0.06] px-3 py-1.5 text-xs font-semibold text-ink-100 hover:bg-white/[0.1]"
      >
        Personalizado
      </button>
      <button
        onClick={() => router.push("/fluxo-de-caixa")}
        className="rounded-md px-3 py-1.5 text-xs font-medium text-ink-500 hover:text-ink-100"
      >
        Mês atual
      </button>

      <dialog
        ref={dialogRef}
        className="card-premium w-full max-w-sm rounded-lg p-0 text-ink-50 backdrop:bg-black/70"
      >
        <div className="space-y-4 p-6">
          <h2 className="font-display text-base font-bold text-ink-50">Período personalizado</h2>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-ink-100">De</label>
              <input
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="mt-1 w-full rounded-md border border-ink-700 bg-ink-950 px-3 py-2 text-ink-50 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-ink-100">Até</label>
              <input
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                className="mt-1 w-full rounded-md border border-ink-700 bg-ink-950 px-3 py-2 text-ink-50 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
              />
            </div>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => dialogRef.current?.close()}
              className="rounded-md px-4 py-2 text-sm font-medium text-ink-300 hover:text-ink-50"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={applyCustom}
              className="rounded-md bg-gradient-to-b from-amber-300 to-amber-500 px-4 py-2 text-sm font-semibold text-ink-950 glow-amber transition hover:brightness-105"
            >
              Aplicar
            </button>
          </div>
        </div>
      </dialog>
    </div>
  );
}
