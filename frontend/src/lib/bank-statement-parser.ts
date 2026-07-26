import * as XLSX from "xlsx";

export type ParsedStatementRow = {
  date: string; // YYYY-MM-DD
  description: string;
  amount: number; // sempre positivo
  type: "DEBIT" | "CREDIT";
};

const DATE_COLUMN_NAMES = ["data", "date", "dt", "data lançamento", "data do lançamento"];
const DESCRIPTION_COLUMN_NAMES = ["descrição", "descricao", "description", "histórico", "historico", "memo"];
const AMOUNT_COLUMN_NAMES = ["valor", "amount", "value", "montante"];

function normalizeHeader(header: string): string {
  return header.trim().toLowerCase();
}

function findColumn(headers: string[], candidates: string[]): string | undefined {
  return headers.find((h) => candidates.includes(normalizeHeader(h)));
}

function parseBRDate(raw: string): string | null {
  const trimmed = raw.trim();
  // dd/mm/yyyy ou dd-mm-yyyy
  const brMatch = trimmed.match(/^(\d{2})[/-](\d{2})[/-](\d{4})$/);
  if (brMatch) {
    const [, day, month, year] = brMatch;
    return `${year}-${month}-${day}`;
  }
  // yyyy-mm-dd (já no formato certo)
  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  }
  return null;
}

/**
 * Células numéricas do Excel chegam como `number` do JS (ex: -0.55), já com
 * o valor correto — convertê-las para string e reaplicar a lógica de
 * vírgula/ponto do formato brasileiro trocaria "-0.55" por "-055" (o ponto
 * decimal seria removido como se fosse separador de milhar), inflando o
 * valor 100x. Só texto (CSV, ou célula Excel formatada como texto) passa
 * pela conversão de formato PT-BR.
 */
function parseAmount(raw: unknown): number {
  if (typeof raw === "number") {
    return raw;
  }
  const cleaned = String(raw ?? "")
    .trim()
    .replace(/\./g, "")
    .replace(",", ".")
    .replace(/[^\d.-]/g, "");
  return parseFloat(cleaned);
}

/** Tenta detectar automaticamente as colunas de data/descrição/valor por nome comum (PT/EN). */
export function detectColumns(
  headers: string[]
): { dateCol?: string; descCol?: string; amountCol?: string } {
  return {
    dateCol: findColumn(headers, DATE_COLUMN_NAMES),
    descCol: findColumn(headers, DESCRIPTION_COLUMN_NAMES),
    amountCol: findColumn(headers, AMOUNT_COLUMN_NAMES),
  };
}

/**
 * Converte linhas de uma planilha (CSV/Excel) em transações, usando as
 * colunas informadas (detectadas automaticamente ou escolhidas manualmente
 * pelo usuário quando a detecção falha) — funciona para extratos do Asaas,
 * Inter e a maioria dos bancos/gateways que exportam CSV ou Excel.
 */
export function parseCsvStatement(
  rows: Record<string, unknown>[],
  columns: { dateCol: string; descCol: string; amountCol: string }
): ParsedStatementRow[] {
  const { dateCol, descCol, amountCol } = columns;
  const parsed: ParsedStatementRow[] = [];

  for (const row of rows) {
    const dateRaw = String(row[dateCol] ?? "");
    const date = parseBRDate(dateRaw);
    const amountRaw = parseAmount(row[amountCol]);
    if (!date || isNaN(amountRaw) || amountRaw === 0) continue;

    parsed.push({
      date,
      description: String(row[descCol] ?? "").trim(),
      amount: Math.abs(amountRaw),
      type: amountRaw >= 0 ? "CREDIT" : "DEBIT",
    });
  }

  return parsed;
}

/**
 * Extratos de alguns bancos/gateways (ex: Asaas) têm linhas de metadados
 * (período, saldo inicial) antes do cabeçalho de verdade — sheet_to_json
 * ingênuo trataria a primeira linha como cabeçalho e nunca encontraria as
 * colunas certas. Varremos as primeiras linhas procurando a que tem mais
 * células preenchidas e bate com pelo menos um nome de coluna conhecido.
 */
function findHeaderRowIndex(rows: unknown[][]): number {
  const MAX_ROWS_TO_SCAN = 20;
  const allCandidates = [...DATE_COLUMN_NAMES, ...DESCRIPTION_COLUMN_NAMES, ...AMOUNT_COLUMN_NAMES];

  let bestIndex = 0;
  let bestScore = -1;

  for (let i = 0; i < Math.min(rows.length, MAX_ROWS_TO_SCAN); i++) {
    const row = rows[i];
    if (!row || row.length === 0) continue;

    const normalizedCells = row.map((c) => normalizeHeader(String(c ?? "")));
    const nonEmptyCount = normalizedCells.filter((c) => c !== "").length;
    const matchesKnownColumn = normalizedCells.some((c) => allCandidates.includes(c));

    if (matchesKnownColumn && nonEmptyCount > bestScore) {
      bestScore = nonEmptyCount;
      bestIndex = i;
    }
  }

  return bestScore >= 0 ? bestIndex : 0;
}

export function readSheetAsRows(binaryData: string): Record<string, unknown>[] {
  const workbook = XLSX.read(binaryData, { type: "binary" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const allRows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "" });

  const headerIndex = findHeaderRowIndex(allRows);
  const headerRow = (allRows[headerIndex] ?? []).map((c) => String(c ?? "").trim());
  const dataRows = allRows.slice(headerIndex + 1);

  return dataRows
    .filter((row) => row.some((cell) => String(cell ?? "").trim() !== ""))
    .map((row) => {
      const record: Record<string, unknown> = {};
      headerRow.forEach((header, i) => {
        if (header) record[header] = row[i] ?? "";
      });
      return record;
    });
}

/**
 * Parser simples de OFX (SGML) — extrai os blocos <STMTTRN> sem depender de
 * lib externa, já que o formato é regular o suficiente para split/regex.
 */
export function parseOfxStatement(text: string): ParsedStatementRow[] {
  const transactions: ParsedStatementRow[] = [];
  const blocks = text.split(/<STMTTRN>/i).slice(1);

  for (const block of blocks) {
    const end = block.search(/<\/STMTTRN>/i);
    const content = end >= 0 ? block.slice(0, end) : block;

    const typeMatch = content.match(/<TRNTYPE>([^\r\n<]+)/i);
    const dateMatch = content.match(/<DTPOSTED>(\d{8})/i);
    const amountMatch = content.match(/<TRNAMT>([^\r\n<]+)/i);
    const memoMatch = content.match(/<MEMO>([^\r\n<]+)/i) ?? content.match(/<NAME>([^\r\n<]+)/i);

    if (!dateMatch || !amountMatch) continue;

    const rawDate = dateMatch[1];
    const date = `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6, 8)}`;
    const amount = parseFloat(amountMatch[1].trim());
    if (isNaN(amount) || amount === 0) continue;

    transactions.push({
      date,
      description: (memoMatch?.[1] ?? typeMatch?.[1] ?? "Transação").trim(),
      amount: Math.abs(amount),
      type: amount >= 0 ? "CREDIT" : "DEBIT",
    });
  }

  return transactions;
}
