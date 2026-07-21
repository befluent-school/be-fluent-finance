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

function parseAmount(raw: string): number {
  const cleaned = raw.trim().replace(/\./g, "").replace(",", ".").replace(/[^\d.-]/g, "");
  return parseFloat(cleaned);
}

/**
 * Detecta colunas de data/descrição/valor por nome comum (PT/EN) — funciona
 * para extratos do Asaas, Inter e a maioria dos bancos. Se não detectar com
 * confiança, retorna null para o chamador pedir mapeamento manual.
 */
export function parseCsvStatement(
  rows: Record<string, unknown>[]
): ParsedStatementRow[] | null {
  if (rows.length === 0) return null;

  const headers = Object.keys(rows[0]);
  const dateCol = findColumn(headers, DATE_COLUMN_NAMES);
  const descCol = findColumn(headers, DESCRIPTION_COLUMN_NAMES);
  const amountCol = findColumn(headers, AMOUNT_COLUMN_NAMES);

  if (!dateCol || !descCol || !amountCol) return null;

  const parsed: ParsedStatementRow[] = [];
  for (const row of rows) {
    const dateRaw = String(row[dateCol] ?? "");
    const date = parseBRDate(dateRaw);
    const amountRaw = parseAmount(String(row[amountCol] ?? ""));
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

export function readSheetAsRows(binaryData: string): Record<string, unknown>[] {
  const workbook = XLSX.read(binaryData, { type: "binary" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
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
