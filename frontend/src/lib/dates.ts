const formatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Sao_Paulo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Data de hoje (YYYY-MM-DD) no fuso de Brasília, em qualquer servidor ou navegador. */
export function todayBR(): string {
  return formatter.format(new Date());
}

/** Mês corrente (YYYY-MM) no fuso de Brasília. */
export function currentMonthBR(): string {
  return todayBR().slice(0, 7);
}

// Datas sem hora ('YYYY-MM-DD') não podem passar por new Date(): viram meia-noite
// UTC e, em Brasília, recuam um dia (ou um mês, no dia 1).

/** 'YYYY-MM-DD' → 'DD/MM/AAAA'. */
export function formatDateBR(isoDate: string | null | undefined): string {
  if (!isoDate) return "—";
  const [y, m, d] = isoDate.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

/** 'YYYY-MM' ou 'YYYY-MM-DD' → 'outubro de 2026' (ou 'out.' com style 'short'). */
export function formatMonthBR(value: string, style: "long" | "short" = "long"): string {
  const date = new Date(`${value.slice(0, 7)}-01T12:00:00Z`);
  return date.toLocaleDateString("pt-BR", {
    timeZone: "UTC",
    month: style,
    ...(style === "long" ? { year: "numeric" } : {}),
  });
}

/** Data e hora (timestamp) no horário de Brasília: 'DD/MM/AAAA HH:MM'. */
export function formatDateTimeBR(value: string | Date | null | undefined): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    dateStyle: "short",
    timeStyle: "short",
  });
}
