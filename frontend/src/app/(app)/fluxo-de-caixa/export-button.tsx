"use client";

import { formatDateBR } from "@/lib/dates";

export type ExportRow = {
  date: string;
  description: string;
  category: string | null;
  source: string;
  type: "entrada" | "saida";
  amount: number;
  running_balance: number | null;
};

const SOURCE_LABEL: Record<string, string> = {
  manual: "Manual",
  pluggy: "Pluggy (legado)",
  manual_import: "Extrato importado",
  opening: "Saldo inicial",
  asaas: "ASAAS",
  inter: "Inter PJ",
  api_sync: "Banco (sync)",
};

function escCsv(v: string | number | null): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function ExportButton({ rows, periodLabel }: { rows: ExportRow[]; periodLabel: string }) {
  function download() {
    const header = ["Data", "Descrição", "Categoria", "Origem", "Tipo", "Valor (R$)", "Saldo acumulado (R$)"];
    const lines = rows.map((r) => [
      formatDateBR(r.date),
      r.description,
      r.category ?? "",
      SOURCE_LABEL[r.source] ?? r.source,
      r.type === "entrada" ? "Entrada" : "Saída",
      r.amount.toFixed(2).replace(".", ","),
      r.running_balance === null ? "" : r.running_balance.toFixed(2).replace(".", ","),
    ].map(escCsv).join(";"));

    const bom = "﻿"; // BOM para Excel abrir UTF-8 corretamente
    const csv = bom + [header.join(";"), ...lines].join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `fluxo-de-caixa-${periodLabel.replace(/[^a-z0-9]/gi, "-").toLowerCase()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <button
      onClick={download}
      className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium text-ink-300 ring-1 ring-inset ring-ink-700 hover:text-ink-50"
    >
      <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
        <path d="M8 12l-4-4h2.5V4h3v4H12L8 12zm-6 2h12v-1.5H2V14z" />
      </svg>
      Exportar CSV
    </button>
  );
}

