import * as z from "zod";

/** Data 'YYYY-MM-DD' que existe de fato no calendário. */
export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, { error: "Data inválida." })
  .refine((v) => {
    const d = new Date(`${v}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
  }, { error: "Data inválida." });

/** Primeiro dia do mês de referência: 'YYYY-MM-01'. */
export const referenceMonthDate = isoDate.refine((v) => v.endsWith("-01"), {
  error: "Mês de referência inválido.",
});

/** Mês 'YYYY-MM' (parâmetros de URL e geração de mensalidades). */
export const yearMonth = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, { error: "Mês inválido." });

/** Valor em reais que cabe em numeric(10,2). */
export const money = z.coerce.number().min(0, { error: "Valor inválido." }).max(99_999_999.99, { error: "Valor alto demais." });

/** Lê um parâmetro de URL 'YYYY-MM'; volta ao padrão se vier malformado. */
export function parseYearMonth(value: string | undefined, fallback: string): string {
  return value && yearMonth.safeParse(value).success ? value : fallback;
}

/** Lê um parâmetro de URL 'YYYY-MM-DD'; undefined se malformado. */
export function parseIsoDate(value: string | undefined): string | undefined {
  return value && isoDate.safeParse(value).success ? value : undefined;
}
