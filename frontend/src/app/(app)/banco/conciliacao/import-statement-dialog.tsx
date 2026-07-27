"use client";

import { useRef, useState, useTransition } from "react";
import {
  readSheetAsRows,
  detectColumns,
  parseCsvStatement,
  parseOfxStatement,
  type ParsedStatementRow,
} from "@/lib/bank-statement-parser";
import {
  confirmBankImport,
  suggestCategoriesForImport,
  findTransferMatches,
} from "@/app/actions/bank-import";

const inputClass =
  "mt-1 w-full rounded-md border border-ink-700 bg-ink-950 px-3 py-2 text-ink-50 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500";

const TRANSFER_CATEGORY_NAME = "Transferência entre Contas";

type Category = { id: string; name: string };

export function ImportStatementDialog({ categories }: { categories: Category[] }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<"select" | "mapping" | "preview" | "done">("select");
  const [accountLabel, setAccountLabel] = useState("");
  const [fileName, setFileName] = useState("");
  const [sheetRows, setSheetRows] = useState<Record<string, unknown>[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [dateCol, setDateCol] = useState("");
  const [descCol, setDescCol] = useState("");
  const [amountCol, setAmountCol] = useState("");
  const [rows, setRows] = useState<ParsedStatementRow[]>([]);
  const [rowCategories, setRowCategories] = useState<(string | null)[]>([]);
  const [transferMatched, setTransferMatched] = useState<boolean[]>([]);
  const [isPending, startTransition] = useTransition();
  const [isSuggesting, setIsSuggesting] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<{ imported: number; skipped: number } | null>(
    null
  );

  const categoryByName = new Map(categories.map((c) => [c.name, c.id]));

  function reset() {
    setStep("select");
    setAccountLabel("");
    setFileName("");
    setSheetRows([]);
    setHeaders([]);
    setDateCol("");
    setDescCol("");
    setAmountCol("");
    setRows([]);
    setRowCategories([]);
    setTransferMatched([]);
    setParseError(null);
    setImportResult(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function handleOpen() {
    reset();
    dialogRef.current?.showModal();
  }

  function goToPreview(parsedRows: ParsedStatementRow[]) {
    setRows(parsedRows);
    setRowCategories(parsedRows.map(() => null));
    setStep("preview");

    const hasTransferCategory = categories.some((c) => c.name === TRANSFER_CATEGORY_NAME);

    // Auto-match de transferências entre contas (data + valor) roda primeiro
    // e tem prioridade: uma linha identificada como par de transferência não
    // deve ser sobrescrita pela sugestão de categoria da IA depois.
    const transferMatchPromise = hasTransferCategory
      ? findTransferMatches(parsedRows.map((r) => ({ date: r.date, amount: r.amount, type: r.type })))
      : Promise.resolve(parsedRows.map(() => false));

    if (categories.length === 0) return;
    setIsSuggesting(true);

    Promise.all([
      transferMatchPromise,
      suggestCategoriesForImport(
        parsedRows.map((r) => r.description),
        categories.map((c) => c.name)
      ),
    ])
      .then(([transferMatches, suggestions]) => {
        setTransferMatched(transferMatches);
        setRowCategories(
          suggestions.map((s, i) => (transferMatches[i] ? TRANSFER_CATEGORY_NAME : s.suggestedCategory))
        );
      })
      .finally(() => setIsSuggesting(false));
  }

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setParseError(null);

    const isOfx = file.name.toLowerCase().endsWith(".ofx");

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = e.target?.result;

        if (isOfx) {
          const parsed = parseOfxStatement(String(data));
          if (parsed.length === 0) {
            setParseError("Não foi possível encontrar transações no arquivo OFX.");
            return;
          }
          goToPreview(parsed);
          return;
        }

        const parsedRows = readSheetAsRows(data as string);
        if (parsedRows.length === 0) {
          setParseError("A planilha está vazia.");
          return;
        }

        const fileHeaders = Object.keys(parsedRows[0]);
        const detected = detectColumns(fileHeaders);
        setSheetRows(parsedRows);
        setHeaders(fileHeaders);
        setDateCol(detected.dateCol ?? "");
        setDescCol(detected.descCol ?? "");
        setAmountCol(detected.amountCol ?? "");

        if (detected.dateCol && detected.descCol && detected.amountCol) {
          const parsed = parseCsvStatement(parsedRows, {
            dateCol: detected.dateCol,
            descCol: detected.descCol,
            amountCol: detected.amountCol,
          });
          if (parsed.length === 0) {
            setStep("mapping");
            return;
          }
          goToPreview(parsed);
        } else {
          setStep("mapping");
        }
      } catch {
        setParseError(
          "Não foi possível ler o arquivo. Verifique se é um .csv, .xlsx ou .ofx válido."
        );
      }
    };

    if (isOfx) reader.readAsText(file);
    else reader.readAsBinaryString(file);
  }

  function handleConfirmMapping() {
    if (!dateCol || !descCol || !amountCol) {
      setParseError("Selecione as três colunas para continuar.");
      return;
    }
    const parsed = parseCsvStatement(sheetRows, { dateCol, descCol, amountCol });
    if (parsed.length === 0) {
      setParseError(
        "Nenhuma transação válida encontrada com essas colunas. Verifique o mapeamento."
      );
      return;
    }
    setParseError(null);
    goToPreview(parsed);
  }

  function handleConfirmImport() {
    startTransition(async () => {
      const payload = rows.map((row, i) => ({
        date: row.date,
        description: row.description,
        amount: row.amount,
        type: row.type,
        categoryId: rowCategories[i] ? (categoryByName.get(rowCategories[i]!) ?? null) : null,
      }));
      const res = await confirmBankImport(accountLabel, payload);
      if (res.success) {
        setImportResult({ imported: res.imported, skipped: res.skipped });
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
        className="card-premium w-full max-w-3xl rounded-lg p-0 text-ink-50 backdrop:bg-black/70"
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
                Exporte o extrato do seu banco (CSV, Excel ou OFX) e envie aqui. Você revisa as
                categorias antes de confirmar, e as transações já entram direto no fluxo de
                caixa.
              </p>

              <div>
                <label className="block text-sm font-medium text-ink-100">
                  Conta / banco (ex: Asaas, Banco Inter)
                </label>
                <input
                  value={accountLabel}
                  onChange={(e) => setAccountLabel(e.target.value)}
                  className={inputClass}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-ink-100">
                  Arquivo (.csv, .xlsx, .xls ou .ofx)
                </label>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,.xlsx,.xls,.ofx"
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

          {step === "mapping" && (
            <div className="space-y-4">
              <p className="text-sm text-ink-300">
                Não conseguimos identificar as colunas automaticamente. Selecione qual coluna do
                arquivo corresponde a cada campo:
              </p>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div>
                  <label className="block text-sm font-medium text-ink-100">Data</label>
                  <select value={dateCol} onChange={(e) => setDateCol(e.target.value)} className={inputClass}>
                    <option value="">Selecione</option>
                    {headers.map((h) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-ink-100">Descrição</label>
                  <select value={descCol} onChange={(e) => setDescCol(e.target.value)} className={inputClass}>
                    <option value="">Selecione</option>
                    {headers.map((h) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-ink-100">Valor</label>
                  <select value={amountCol} onChange={(e) => setAmountCol(e.target.value)} className={inputClass}>
                    <option value="">Selecione</option>
                    {headers.map((h) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {sheetRows.length > 0 && (
                <div className="max-h-48 overflow-y-auto card-premium rounded-md">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-ink-700 bg-white/[0.03] text-ink-300">
                        {headers.map((h) => (
                          <th key={h} className="px-3 py-2 font-medium">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {sheetRows.slice(0, 3).map((row, i) => (
                        <tr key={i} className="border-b border-ink-700/70 last:border-0">
                          {headers.map((h) => (
                            <td key={h} className="px-3 py-2 text-ink-300">
                              {String(row[h] ?? "")}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

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
                  onClick={handleConfirmMapping}
                  className="rounded-md bg-gradient-to-b from-amber-300 to-amber-500 px-4 py-2 text-sm font-semibold text-ink-950 glow-amber transition hover:brightness-105"
                >
                  Continuar
                </button>
              </div>
            </div>
          )}

          {step === "preview" && (
            <div className="space-y-4">
              <p className="text-sm text-ink-300">
                Arquivo: <span className="text-ink-100">{fileName}</span> · {rows.length}{" "}
                transação(ões) · revise as categorias antes de confirmar
                {isSuggesting && " · sugerindo categorias com IA..."}
              </p>
              {transferMatched.some(Boolean) && (
                <p className="text-xs text-amber-400">
                  {transferMatched.filter(Boolean).length} transação(ões) identificada(s)
                  automaticamente como transferência entre suas próprias contas (mesma data e
                  valor de um lançamento já existente) — marcadas como &quot;Transferência entre
                  Contas&quot; para não contar como receita/despesa duplicada. Revise se algum
                  match estiver errado.
                </p>
              )}

              <div className="max-h-96 overflow-y-auto card-premium rounded-md">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-ink-700 bg-white/[0.03] text-xs text-ink-300">
                      <th className="px-3 py-2 font-medium">Data</th>
                      <th className="px-3 py-2 font-medium">Descrição</th>
                      <th className="px-3 py-2 font-medium">Valor</th>
                      <th className="px-3 py-2 font-medium">Categoria</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, i) => (
                      <tr
                        key={i}
                        className={`border-b border-ink-700/70 last:border-0 ${
                          transferMatched[i] ? "bg-amber-500/[0.06]" : ""
                        }`}
                      >
                        <td className="px-3 py-2 text-ink-100">
                          {new Date(row.date + "T00:00:00").toLocaleDateString("pt-BR")}
                        </td>
                        <td className="px-3 py-2 text-ink-300">
                          {row.description}
                          {transferMatched[i] && (
                            <span className="ml-2 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-400">
                              transferência
                            </span>
                          )}
                        </td>
                        <td
                          className={`px-3 py-2 font-medium ${
                            row.type === "CREDIT" ? "text-status-paid" : "text-status-overdue"
                          }`}
                        >
                          {row.type === "CREDIT" ? "+" : "-"} {row.amount.toFixed(2)}
                        </td>
                        <td className="px-3 py-2">
                          <select
                            value={rowCategories[i] ?? ""}
                            onChange={(e) => {
                              const next = [...rowCategories];
                              next[i] = e.target.value || null;
                              setRowCategories(next);
                            }}
                            className="w-full rounded-md border border-ink-700 bg-ink-950 px-2 py-1 text-xs text-ink-50"
                          >
                            <option value="">Sem categoria</option>
                            {categories.map((c) => (
                              <option key={c.id} value={c.name}>
                                {c.name}
                              </option>
                            ))}
                          </select>
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
                  {isPending ? "Lançando..." : `Confirmar e lançar ${rows.length} transação(ões)`}
                </button>
              </div>
            </div>
          )}

          {step === "done" && importResult !== null && (
            <div className="space-y-4">
              <p className="text-sm text-ink-300">
                {importResult.imported} transação(ões) lançada(s) no fluxo de caixa
                {importResult.skipped > 0 &&
                  ` · ${importResult.skipped} já existente(s), ignorada(s) automaticamente`}
                . Confira em &quot;Extrato completo&quot; ou na aba Fluxo de Caixa.
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
