"use client";

import { useRef, useState, useTransition } from "react";
import * as XLSX from "xlsx";
import {
  importStudents,
  type ImportRowResult,
  type ImportStudentRow,
} from "@/app/actions/import-students";

const TEMPLATE_HEADERS = [
  "Nome do Aluno",
  "Responsável",
  "CPF",
  "Telefone",
  "E-mail",
  "Plano",
  "Professor",
  "Valor da Mensalidade",
  "Dia de Vencimento",
];

type ParsedRow = {
  raw: Record<string, unknown>;
  data: ImportStudentRow;
  clientError?: string;
};

function cellToString(value: unknown): string {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function parseSheet(rows: Record<string, unknown>[]): ParsedRow[] {
  return rows.map((raw) => {
    const fullName = cellToString(raw["Nome do Aluno"]);
    const planName = cellToString(raw["Plano"]);
    const monthlyValueRaw = cellToString(raw["Valor da Mensalidade"]);
    const dueDayRaw = cellToString(raw["Dia de Vencimento"]);

    const data: ImportStudentRow = {
      fullName,
      payerName: cellToString(raw["Responsável"]) || null,
      cpf: cellToString(raw["CPF"]) || null,
      phone: cellToString(raw["Telefone"]) || null,
      email: cellToString(raw["E-mail"]) || null,
      planName,
      teacherName: cellToString(raw["Professor"]) || null,
      monthlyValue: monthlyValueRaw,
      dueDay: dueDayRaw,
    };

    let clientError: string | undefined;
    if (!fullName || fullName.length < 2) clientError = "Nome do aluno é obrigatório.";
    else if (!planName) clientError = "Plano é obrigatório.";
    else if (!monthlyValueRaw || isNaN(Number(monthlyValueRaw)))
      clientError = "Valor da mensalidade inválido.";
    else if (!dueDayRaw || isNaN(Number(dueDayRaw)) || Number(dueDayRaw) < 1 || Number(dueDayRaw) > 28)
      clientError = "Dia de vencimento inválido (1-28).";

    return { raw, data, clientError };
  });
}

export function ImportStudentsDialog() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<"select" | "preview" | "done">("select");
  const [parsedRows, setParsedRows] = useState<ParsedRow[]>([]);
  const [fileName, setFileName] = useState("");
  const [results, setResults] = useState<ImportRowResult[]>([]);
  const [isPending, startTransition] = useTransition();
  const [parseError, setParseError] = useState<string | null>(null);

  function reset() {
    setStep("select");
    setParsedRows([]);
    setFileName("");
    setResults([]);
    setParseError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function handleOpen() {
    reset();
    dialogRef.current?.showModal();
  }

  function handleDownloadTemplate() {
    const worksheet = XLSX.utils.aoa_to_sheet([TEMPLATE_HEADERS]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Alunos");
    XLSX.writeFile(workbook, "modelo-importacao-alunos.xlsx");
  }

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setParseError(null);

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = e.target?.result;
        const workbook = XLSX.read(data, { type: "binary" });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });

        if (rows.length === 0) {
          setParseError("A planilha está vazia.");
          return;
        }

        setParsedRows(parseSheet(rows));
        setStep("preview");
      } catch {
        setParseError("Não foi possível ler o arquivo. Verifique se é um .xlsx ou .csv válido.");
      }
    };
    reader.readAsBinaryString(file);
  }

  function handleConfirmImport() {
    const validRows = parsedRows.filter((r) => !r.clientError).map((r) => r.data);
    startTransition(async () => {
      const res = await importStudents(validRows);
      setResults(res);
      setStep("done");
    });
  }

  const validCount = parsedRows.filter((r) => !r.clientError).length;
  const invalidCount = parsedRows.length - validCount;

  return (
    <>
      <button
        onClick={handleOpen}
        className="rounded-md border border-ink-700 bg-ink-900 px-4 py-2 text-sm font-semibold text-ink-100 transition hover:border-amber-500/50 hover:text-amber-300"
      >
        Importar planilha
      </button>

      <dialog
        ref={dialogRef}
        className="card-premium w-full max-w-2xl rounded-lg p-0 text-ink-50 backdrop:bg-black/70"
      >
        <div className="space-y-4 p-6">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-lg font-bold text-ink-50">Importar alunos</h2>
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
                Envie uma planilha .xlsx ou .csv com os alunos a cadastrar. Cada linha vira um
                aluno + matrícula.
              </p>
              <button
                type="button"
                onClick={handleDownloadTemplate}
                className="text-sm font-medium text-amber-400 hover:text-amber-300"
              >
                Baixar modelo (.xlsx)
              </button>

              <div>
                <label className={labelClass}>Arquivo</label>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  onChange={handleFileChange}
                  className="mt-1 block w-full text-sm text-ink-300 file:mr-3 file:rounded-md file:border-0 file:bg-amber-500/15 file:px-3 file:py-2 file:text-xs file:font-semibold file:text-amber-300 hover:file:bg-amber-500/25"
                />
              </div>

              {parseError && <p className="text-sm text-status-overdue">{parseError}</p>}
            </div>
          )}

          {step === "preview" && (
            <div className="space-y-4">
              <p className="text-sm text-ink-300">
                Arquivo: <span className="text-ink-100">{fileName}</span>
              </p>
              <div className="flex gap-4 text-sm">
                <span className="text-status-paid">{validCount} válido(s)</span>
                {invalidCount > 0 && (
                  <span className="text-status-overdue">{invalidCount} com erro</span>
                )}
              </div>

              <div className="max-h-80 overflow-y-auto card-premium rounded-md">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-ink-700 bg-white/[0.03] text-xs text-ink-300">
                      <th className="px-3 py-2 font-medium">Nome</th>
                      <th className="px-3 py-2 font-medium">Plano</th>
                      <th className="px-3 py-2 font-medium">Mensalidade</th>
                      <th className="px-3 py-2 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsedRows.map((row, i) => (
                      <tr key={i} className="border-b border-ink-700/70 last:border-0">
                        <td className="px-3 py-2 text-ink-100">{row.data.fullName || "—"}</td>
                        <td className="px-3 py-2 text-ink-300">{row.data.planName || "—"}</td>
                        <td className="px-3 py-2 text-ink-300">
                          {String(row.data.monthlyValue || "—")}
                        </td>
                        <td className="px-3 py-2">
                          {row.clientError ? (
                            <span className="text-xs text-status-overdue">{row.clientError}</span>
                          ) : (
                            <span className="text-xs text-status-paid">OK</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

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
                  disabled={validCount === 0 || isPending}
                  onClick={handleConfirmImport}
                  className="rounded-md bg-gradient-to-b from-amber-300 to-amber-500 px-4 py-2 text-sm font-semibold text-ink-950 glow-amber transition hover:brightness-105 disabled:opacity-60"
                >
                  {isPending ? "Importando..." : `Importar ${validCount} aluno(s)`}
                </button>
              </div>
            </div>
          )}

          {step === "done" && (
            <div className="space-y-4">
              <p className="text-sm text-ink-300">
                {results.filter((r) => r.success).length} de {results.length} aluno(s) importado(s)
                com sucesso.
              </p>
              <div className="max-h-80 overflow-y-auto card-premium rounded-md">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-ink-700 bg-white/[0.03] text-xs text-ink-300">
                      <th className="px-3 py-2 font-medium">Linha</th>
                      <th className="px-3 py-2 font-medium">Nome</th>
                      <th className="px-3 py-2 font-medium">Resultado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.map((r) => (
                      <tr key={r.row} className="border-b border-ink-700/70 last:border-0">
                        <td className="px-3 py-2 text-ink-300">{r.row}</td>
                        <td className="px-3 py-2 text-ink-100">{r.fullName}</td>
                        <td className="px-3 py-2">
                          {r.success ? (
                            <span className="text-xs text-status-paid">Importado</span>
                          ) : (
                            <span className="text-xs text-status-overdue">{r.error}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
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

const labelClass = "block text-sm font-medium text-ink-100";
