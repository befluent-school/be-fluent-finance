"use client";

import { useRef, useState, useTransition } from "react";
import {
  readSheetAsRows,
  parseCsvStatement,
  parseOfxStatement,
  type ParsedStatementRow,
} from "@/lib/bank-statement-parser";
import { importBankStatement, suggestCategoriesForImport } from "@/app/actions/bank-import";

export function ImportStatementDialog({ categoryNames }: { categoryNames: string[] }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<"select" | "preview" | "done">("select");
  const [accountLabel, setAccountLabel] = useState("");
  const [fileName, setFileName] = useState("");
  const [format, setFormat] = useState<"csv" | "ofx">("csv");
  const [rows, setRows] = useState<ParsedStatementRow[]>([]);
  const [suggestions, setSuggestions] = useState<Map<string, string | null>>(new Map());
  const [isPending, startTransition] = useTransition();
  const [isSuggesting, setIsSuggesting] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [result, setResult] = useState<{ imported: number; skipped: number } | null>(null);

  function reset() {
    setStep("select");
    setAccountLabel("");
    setFileName("");
    setRows([]);
    setSuggestions(new Map());
    setParseError(null);
    setResult(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function handleOpen() {
    reset();
    dialogRef.current?.showModal();
  }

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setParseError(null);

    const isOfx = file.name.toLowerCase().endsWith(".ofx");
    setFormat(isOfx ? "ofx" : "csv");

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = e.target?.result;
        let parsed: ParsedStatementRow[] | null;

        if (isOfx) {
          parsed = parseOfxStatement(String(data));
        } else {
          const sheetRows = readSheetAsRows(data as string);
          parsed = parseCsvStatement(sheetRows);
        }

        if (!parsed || parsed.length === 0) {
          setParseError(
            "Não foi possível identificar as colunas de data/descrição/valor no arquivo."
          );
          return;
        }

        setRows(parsed);
        setStep("preview");

        if (categoryNames.length > 0) {
          setIsSuggesting(true);
          suggestCategoriesForImport(parsed.map((r) => r.description), categoryNames)
            .then((results) => {
              const map = new Map<string, string | null>();
              for (const r of results) map.set(r.description, r.suggestedCategory);
              setSuggestions(map);
            })
            .finally(() => setIsSuggesting(false));
        }
      } catch {
        setParseError("Não foi possível ler o arquivo. Verifique se é um .csv ou .ofx válido.");
      }
    };

    if (isOfx) reader.readAsText(file);
    else reader.readAsBinaryString(file);
  }

  function handleConfirmImport() {
    startTransition(async () => {
      const res = await importBankStatement(accountLabel, format, fileName, rows);
      if (res.success) {
        setResult({ imported: res.imported, skipped: res.skipped });
        setStep("done");
      } else {
        setParseError(res.error);
      }
    });
  }

  return (
    <>
      <button
        onClick={handleOpen}
        className="rounded-md bg-gradient-to-b from-amber-300 to-amber-500 px-4 py-2 text-sm font-semibold text-ink-950 glow-amber transition hover:brightness-105"
      >
        + Importar extrato
      </button>

      <dialog
        ref={dialogRef}
        className="card-premium w-full max-w-2xl rounded-lg p-0 text-ink-50 backdrop:bg-black/70"
      >
        <div className="space-y-4 p-6">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-lg font-bold text-ink-50">Importar extrato bancário</h2>
            <button
              type="button"
              onClick={() => dialogRef.current?.close()}
              className="text-sm text-ink-300 hover:text-ink-50"
            >
              Fechar
            </button>
          </div>

          {step === "select" && (
            <div className="space-y-4">
              <p className="text-sm text-ink-300">
                Exporte o extrato do seu banco (CSV ou OFX) e envie aqui. As transações
                aparecerão em &quot;Pendentes&quot; para você confirmar antes de virarem
                lançamentos reais.
              </p>

              <div>
                <label className="block text-sm font-medium text-ink-100">
                  Conta / banco (ex: Asaas, Banco Inter)
                </label>
                <input
                  value={accountLabel}
                  onChange={(e) => setAccountLabel(e.target.value)}
                  className="mt-1 w-full rounded-md border border-ink-700 bg-ink-950 px-3 py-2 text-ink-50 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-ink-100">Arquivo (.csv ou .ofx)</label>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,.ofx"
                  disabled={!accountLabel}
                  onChange={handleFileChange}
                  className="mt-1 block w-full text-sm text-ink-300 file:mr-3 file:rounded-md file:border-0 file:bg-amber-500/15 file:px-3 file:py-2 file:text-xs file:font-semibold file:text-amber-300 hover:file:bg-amber-500/25 disabled:opacity-50"
                />
                {!accountLabel && (
                  <p className="mt-1 text-xs text-ink-500">Informe a conta antes de escolher o arquivo.</p>
                )}
              </div>

              {parseError && <p className="text-sm text-status-overdue">{parseError}</p>}
            </div>
          )}

          {step === "preview" && (
            <div className="space-y-4">
              <p className="text-sm text-ink-300">
                Arquivo: <span className="text-ink-100">{fileName}</span> · {rows.length}{" "}
                transação(ões) encontrada(s)
                {isSuggesting && " · sugerindo categorias com IA..."}
              </p>

              <div className="max-h-80 overflow-y-auto card-premium rounded-md">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-ink-700 bg-white/[0.03] text-xs text-ink-300">
                      <th className="px-3 py-2 font-medium">Data</th>
                      <th className="px-3 py-2 font-medium">Descrição</th>
                      <th className="px-3 py-2 font-medium">Valor</th>
                      <th className="px-3 py-2 font-medium">Categoria sugerida</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, i) => (
                      <tr key={i} className="border-b border-ink-700/70 last:border-0">
                        <td className="px-3 py-2 text-ink-100">
                          {new Date(row.date + "T00:00:00").toLocaleDateString("pt-BR")}
                        </td>
                        <td className="px-3 py-2 text-ink-300">{row.description}</td>
                        <td
                          className={`px-3 py-2 font-medium ${
                            row.type === "CREDIT" ? "text-status-paid" : "text-status-overdue"
                          }`}
                        >
                          {row.type === "CREDIT" ? "+" : "-"} {row.amount.toFixed(2)}
                        </td>
                        <td className="px-3 py-2 text-xs text-ink-500">
                          {suggestions.get(row.description) ?? "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {parseError && <p className="text-sm text-status-overdue">{parseError}</p>}

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={reset}
                  className="rounded-md px-4 py-2 text-sm font-medium text-ink-300 hover:text-ink-50"
                >
                  Voltar
                </button>
                <button
                  type="button"
                  disabled={isPending}
                  onClick={handleConfirmImport}
                  className="rounded-md bg-gradient-to-b from-amber-300 to-amber-500 px-4 py-2 text-sm font-semibold text-ink-950 glow-amber transition hover:brightness-105 disabled:opacity-60"
                >
                  {isPending ? "Importando..." : `Importar ${rows.length} transação(ões)`}
                </button>
              </div>
            </div>
          )}

          {step === "done" && result && (
            <div className="space-y-4">
              <p className="text-sm text-ink-300">
                {result.imported} transação(ões) importada(s)
                {result.skipped > 0 && ` · ${result.skipped} já existente(s), ignorada(s)`}. Vá em
                &quot;Pendentes&quot; para conciliar.
              </p>
              <div className="flex justify-end pt-2">
                <button
                  type="button"
                  onClick={() => dialogRef.current?.close()}
                  className="rounded-md bg-gradient-to-b from-amber-300 to-amber-500 px-4 py-2 text-sm font-semibold text-ink-950 glow-amber transition hover:brightness-105"
                >
                  Concluir
                </button>
              </div>
            </div>
          )}
        </div>
      </dialog>
    </>
  );
}
