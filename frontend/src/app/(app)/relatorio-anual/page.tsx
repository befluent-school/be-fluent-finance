import Link from "next/link";
import { and, eq, gte, isNotNull, isNull, lt, ne, or, sql } from "drizzle-orm";
import { requireUser } from "@/lib/auth/session";
import { withUser, type Tx, sequential } from "@/lib/db";
import { cashTransactions, costCategories, invoices as invoicesTable } from "@/lib/db/schema";
import { formatCurrencyBRL } from "@shared/finance";
import { variation, VariationBadge } from "@/components/ui/variation-badge";
import { MonthlyEvolutionChart } from "../fluxo-de-caixa/monthly-evolution-chart";

const TRANSFER_CATEGORY_NAME = "Transferência entre Contas";

const MONTH_LABELS = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
];

type MonthTotal = { month: string; entrada: number; saida: number };

/** Entradas e saídas por mês do ano (sem transferências entre contas), somadas no banco. */
async function monthTotals(tx: Tx, year: string): Promise<MonthTotal[]> {
  const rows = await tx
    .select({
      month: sql<string>`to_char(${cashTransactions.date}, 'YYYY-MM')`,
      type: cashTransactions.type,
      total: sql<number>`sum(${cashTransactions.amount})`.mapWith(Number),
    })
    .from(cashTransactions)
    .leftJoin(costCategories, eq(costCategories.id, cashTransactions.categoryId))
    .where(
      and(
        gte(cashTransactions.date, `${year}-01-01`),
        lt(cashTransactions.date, `${Number(year) + 1}-01-01`),
        or(isNull(costCategories.name), ne(costCategories.name, TRANSFER_CATEGORY_NAME))
      )
    )
    .groupBy(sql`1`, cashTransactions.type);

  const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`);
  return months.map((month) => ({
    month,
    entrada: rows.find((r) => r.month === month && r.type === "entrada")?.total ?? 0,
    saida: rows.find((r) => r.month === month && r.type === "saida")?.total ?? 0,
  }));
}

export default async function RelatorioAnualPage({
  searchParams,
}: {
  searchParams: Promise<{ ano?: string }>;
}) {
  const { ano } = await searchParams;
  const currentYear = new Date().getFullYear().toString();
  const selectedYear = ano && /^\d{4}$/.test(ano) ? ano : currentYear;
  const previousYear = (Number(selectedYear) - 1).toString();

  const user = await requireUser();

  const { months, previousMonths, paidInvoicesByMonth } = await withUser(user.id, async (tx) => {
    const [months, previousMonths, paid] = await sequential([
      () => monthTotals(tx, selectedYear),
      () => monthTotals(tx, previousYear),
      () => tx
        .select({
          month: sql<string>`to_char(${invoicesTable.referenceMonth}, 'YYYY-MM')`,
          count: sql<number>`count(*)`.mapWith(Number),
        })
        .from(invoicesTable)
        .where(
          and(
            gte(invoicesTable.referenceMonth, `${selectedYear}-01-01`),
            lt(invoicesTable.referenceMonth, `${Number(selectedYear) + 1}-01-01`),
            isNotNull(invoicesTable.paidDate)
          )
        )
        .groupBy(sql`1`),
    ]);
    return { months, previousMonths, paidInvoicesByMonth: new Map(paid.map((r) => [r.month, r.count])) };
  });

  const totalEntrada = months.reduce((sum, m) => sum + m.entrada, 0);
  const totalSaida = months.reduce((sum, m) => sum + m.saida, 0);
  const previousTotalEntrada = previousMonths.reduce((sum, m) => sum + m.entrada, 0);
  const previousTotalSaida = previousMonths.reduce((sum, m) => sum + m.saida, 0);

  return (
    <div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Link
            href={`/relatorio-anual?ano=${Number(selectedYear) - 1}`}
            className="rounded-md px-2 py-1 text-sm text-ink-300 hover:bg-white/[0.05] hover:text-ink-50"
          >
            ‹
          </Link>
          <p className="text-sm text-ink-300">{selectedYear}</p>
          <Link
            href={`/relatorio-anual?ano=${Number(selectedYear) + 1}`}
            className="rounded-md px-2 py-1 text-sm text-ink-300 hover:bg-white/[0.05] hover:text-ink-50"
          >
            ›
          </Link>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-md border border-ink-700 bg-status-paid-bg p-4">
          <p className="text-sm text-status-paid">Entradas no ano</p>
          <p className="font-display font-tabular text-xl font-bold text-status-paid">
            {formatCurrencyBRL(totalEntrada)}
          </p>
          <VariationBadge
            value={variation(totalEntrada, previousTotalEntrada)}
            suffix="vs. ano anterior"
          />
        </div>
        <div className="rounded-md border border-ink-700 bg-status-overdue-bg p-4">
          <p className="text-sm text-status-overdue">Saídas no ano</p>
          <p className="font-display font-tabular text-xl font-bold text-status-overdue">
            {formatCurrencyBRL(totalSaida)}
          </p>
          <VariationBadge
            value={variation(totalSaida, previousTotalSaida)}
            suffix="vs. ano anterior"
          />
        </div>
        <div className="rounded-md border border-ink-700 bg-ink-800/40 p-4">
          <p className="text-sm text-ink-300">Saldo do ano</p>
          <p className="font-display font-tabular text-xl font-bold text-ink-50">
            {formatCurrencyBRL(totalEntrada - totalSaida)}
          </p>
          <VariationBadge
            value={variation(totalEntrada - totalSaida, previousTotalEntrada - previousTotalSaida)}
            suffix="vs. ano anterior"
          />
        </div>
      </div>

      <h2 className="mt-8 text-lg font-semibold text-ink-50">Evolução mensal</h2>
      <div className="mt-3">
        <MonthlyEvolutionChart data={months} />
      </div>

      <h2 className="mt-8 text-lg font-semibold text-ink-50">Detalhamento por mês</h2>
      <div className="mt-3 card-premium overflow-x-auto rounded-md">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-ink-700 bg-white/[0.03] text-left text-xs text-ink-300">
              <th className="px-4 py-3 font-medium">Mês</th>
              <th className="px-4 py-3 font-medium">Entradas</th>
              <th className="px-4 py-3 font-medium">Saídas</th>
              <th className="px-4 py-3 font-medium">Saldo do mês</th>
              <th className="px-4 py-3 font-medium">Mensalidades pagas</th>
            </tr>
          </thead>
          <tbody>
            {months.map((m, i) => (
              <tr key={m.month} className="border-b border-ink-700/70 last:border-0 hover:bg-white/[0.03]">
                <td className="px-4 py-3 text-ink-50">{MONTH_LABELS[i]}</td>
                <td className="font-tabular px-4 py-3 text-status-paid">
                  {formatCurrencyBRL(m.entrada)}
                </td>
                <td className="font-tabular px-4 py-3 text-status-overdue">
                  {formatCurrencyBRL(m.saida)}
                </td>
                <td className="font-tabular px-4 py-3 text-ink-50">
                  {formatCurrencyBRL(m.entrada - m.saida)}
                </td>
                <td className="font-tabular px-4 py-3">{paidInvoicesByMonth.get(m.month) ?? 0}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-ink-700 bg-white/[0.03] font-semibold text-ink-50">
              <td className="px-4 py-3">Total</td>
              <td className="font-tabular px-4 py-3 text-status-paid">
                {formatCurrencyBRL(totalEntrada)}
              </td>
              <td className="font-tabular px-4 py-3 text-status-overdue">
                {formatCurrencyBRL(totalSaida)}
              </td>
              <td className="font-tabular px-4 py-3">{formatCurrencyBRL(totalEntrada - totalSaida)}</td>
              <td className="font-tabular px-4 py-3">
                {Array.from(paidInvoicesByMonth.values()).reduce((sum, n) => sum + n, 0)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
