import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
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

type CashRow = {
  date: string;
  amount: number;
  type: "entrada" | "saida";
  cost_categories: { name: string } | null;
};

function monthTotals(rows: CashRow[], year: string) {
  const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`);
  const nonTransfer = rows.filter((r) => r.cost_categories?.name !== TRANSFER_CATEGORY_NAME);
  return months.map((month) => {
    const entrada = nonTransfer
      .filter((r) => r.date.startsWith(month) && r.type === "entrada")
      .reduce((sum, r) => sum + r.amount, 0);
    const saida = nonTransfer
      .filter((r) => r.date.startsWith(month) && r.type === "saida")
      .reduce((sum, r) => sum + r.amount, 0);
    return { month, entrada, saida };
  });
}

export default async function RelatorioAnualPage({
  searchParams,
}: {
  searchParams: Promise<{ ano?: string }>;
}) {
  const { ano } = await searchParams;
  const currentYear = new Date().getFullYear().toString();
  const selectedYear = ano ?? currentYear;
  const previousYear = (Number(selectedYear) - 1).toString();

  const supabase = await createClient();

  const [{ data: yearRows }, { data: previousYearRows }, { data: invoices }] = await Promise.all([
    supabase
      .from("cash_transactions")
      .select("date, amount, type, cost_categories(name)")
      .gte("date", `${selectedYear}-01-01`)
      .lt("date", `${Number(selectedYear) + 1}-01-01`)
      .returns<CashRow[]>(),
    supabase
      .from("cash_transactions")
      .select("date, amount, type, cost_categories(name)")
      .gte("date", `${previousYear}-01-01`)
      .lt("date", `${selectedYear}-01-01`)
      .returns<CashRow[]>(),
    supabase
      .from("invoices")
      .select("reference_month, paid_date")
      .gte("reference_month", `${selectedYear}-01-01`)
      .lt("reference_month", `${Number(selectedYear) + 1}-01-01`)
      .not("paid_date", "is", null),
  ]);

  const months = monthTotals(yearRows ?? [], selectedYear);
  const previousMonths = monthTotals(previousYearRows ?? [], previousYear);

  const paidInvoicesByMonth = new Map<string, number>();
  for (const inv of invoices ?? []) {
    const month = inv.reference_month.slice(0, 7);
    paidInvoicesByMonth.set(month, (paidInvoicesByMonth.get(month) ?? 0) + 1);
  }

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
