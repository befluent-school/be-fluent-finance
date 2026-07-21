import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { formatCurrencyBRL } from "@shared/finance";
import { NewTransactionForm } from "./new-transaction-form";
import { MonthlyEvolutionChart } from "./monthly-evolution-chart";

type TransactionRow = {
  id: string;
  date: string;
  description: string;
  amount: number;
  type: "entrada" | "saida";
  payment_method: string | null;
  running_balance: number;
  source: string;
  cost_categories: { name: string } | null;
};

const SOURCE_LABEL: Record<string, string> = {
  manual: "Manual",
  pluggy: "Pluggy (legado)",
  manual_import: "Extrato importado",
};

function monthsAgo(n: number): string {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - n);
  return d.toISOString().slice(0, 7);
}

function addMonths(referenceMonth: string, delta: number): string {
  const [year, month] = referenceMonth.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1 + delta, 1)).toISOString().slice(0, 7);
}

function variation(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

function VariationBadge({ value }: { value: number | null }) {
  if (value === null) return null;
  const positive = value >= 0;
  return (
    <span
      className={`ml-2 text-xs font-medium ${positive ? "text-status-paid" : "text-status-overdue"}`}
    >
      {positive ? "▲" : "▼"} {Math.abs(value).toFixed(0)}% vs. mês anterior
    </span>
  );
}

export default async function FluxoDeCaixaPage({
  searchParams,
}: {
  searchParams: Promise<{ mes?: string }>;
}) {
  const { mes } = await searchParams;
  const referenceMonth = mes ?? new Date().toISOString().slice(0, 7);
  const nextMonth = addMonths(referenceMonth, 1);
  const previousMonth = addMonths(referenceMonth, -1);

  const supabase = await createClient();

  const [
    { data: monthTransactions },
    { data: categories },
    { data: yearTransactions },
    { data: previousMonthTransactions },
  ] = await Promise.all([
    supabase
      .from("cash_transactions_with_balance")
      .select(
        "id, date, created_at, description, amount, type, payment_method, running_balance, source, cost_categories(name)"
      )
      .gte("date", `${referenceMonth}-01`)
      .lt("date", `${nextMonth}-01`)
      .order("date", { ascending: false })
      .order("created_at", { ascending: false })
      .returns<TransactionRow[]>(),
    supabase.from("cost_categories").select("id, name, type").eq("active", true),
    supabase
      .from("cash_transactions")
      .select("date, amount, type")
      .gte("date", `${monthsAgo(5)}-01`),
    supabase
      .from("cash_transactions")
      .select("amount, type")
      .gte("date", `${previousMonth}-01`)
      .lt("date", `${referenceMonth}-01`)
      .returns<{ amount: number; type: "entrada" | "saida" }[]>(),
  ]);

  const totals = (monthTransactions ?? []).reduce(
    (acc, t) => {
      acc[t.type] += t.amount;
      return acc;
    },
    { entrada: 0, saida: 0 }
  );

  const previousTotals = (previousMonthTransactions ?? []).reduce(
    (acc, t) => {
      acc[t.type] += t.amount;
      return acc;
    },
    { entrada: 0, saida: 0 }
  );

  const currentBalance = monthTransactions?.[0]?.running_balance ?? 0;
  const previousBalance = currentBalance - totals.entrada + totals.saida;

  const monthlyTotals = Array.from({ length: 6 }, (_, i) => monthsAgo(5 - i)).map((month) => {
    const entrada = (yearTransactions ?? [])
      .filter((t) => t.date.startsWith(month) && t.type === "entrada")
      .reduce((sum, t) => sum + t.amount, 0);
    const saida = (yearTransactions ?? [])
      .filter((t) => t.date.startsWith(month) && t.type === "saida")
      .reduce((sum, t) => sum + t.amount, 0);
    return { month, entrada, saida };
  });

  const categoryTotals = new Map<string, number>();
  for (const t of monthTransactions ?? []) {
    if (t.type !== "saida") continue;
    const name = t.cost_categories?.name ?? "Sem categoria";
    categoryTotals.set(name, (categoryTotals.get(name) ?? 0) + t.amount);
  }
  const sortedCategoryTotals = Array.from(categoryTotals.entries()).sort((a, b) => b[1] - a[1]);

  const monthLabel = new Date(`${referenceMonth}-01`).toLocaleDateString("pt-BR", {
    month: "long",
    year: "numeric",
  });

  return (
    <div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Link
            href={`/fluxo-de-caixa?mes=${previousMonth}`}
            className="rounded-md px-2 py-1 text-sm text-ink-300 hover:bg-white/[0.05] hover:text-ink-50"
          >
            ‹
          </Link>
          <p className="text-sm capitalize text-ink-300">{monthLabel}</p>
          <Link
            href={`/fluxo-de-caixa?mes=${nextMonth}`}
            className="rounded-md px-2 py-1 text-sm text-ink-300 hover:bg-white/[0.05] hover:text-ink-50"
          >
            ›
          </Link>
        </div>
        <NewTransactionForm categories={categories ?? []} />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-md border border-ink-700 bg-status-paid-bg p-4">
          <p className="text-sm text-status-paid">Entradas no mês</p>
          <p className="font-display font-tabular text-xl font-bold text-status-paid">
            {formatCurrencyBRL(totals.entrada)}
          </p>
          <VariationBadge value={variation(totals.entrada, previousTotals.entrada)} />
        </div>
        <div className="rounded-md border border-ink-700 bg-status-overdue-bg p-4">
          <p className="text-sm text-status-overdue">Saídas no mês</p>
          <p className="font-display font-tabular text-xl font-bold text-status-overdue">
            {formatCurrencyBRL(totals.saida)}
          </p>
          <VariationBadge value={variation(totals.saida, previousTotals.saida)} />
        </div>
        <div className="rounded-md border border-ink-700 bg-ink-800/40 p-4">
          <p className="text-sm text-ink-300">Saldo acumulado</p>
          <p className="font-display font-tabular text-xl font-bold text-ink-50">
            {formatCurrencyBRL(currentBalance)}
          </p>
          <VariationBadge value={variation(currentBalance, previousBalance)} />
        </div>
      </div>

      <h2 className="mt-8 text-lg font-semibold text-ink-50">Evolução (últimos 6 meses)</h2>
      <div className="mt-3">
        <MonthlyEvolutionChart data={monthlyTotals} />
      </div>

      <h2 className="mt-8 text-lg font-semibold text-ink-50">Resumo por categoria</h2>
      <div className="mt-3 card-premium overflow-x-auto rounded-md">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-ink-700 bg-white/[0.03] text-left text-xs text-ink-300">
              <th className="px-4 py-3 font-medium">Categoria</th>
              <th className="px-4 py-3 font-medium">Total gasto</th>
            </tr>
          </thead>
          <tbody>
            {sortedCategoryTotals.map(([name, total]) => (
              <tr key={name} className="border-b border-ink-700/70 last:border-0 hover:bg-white/[0.03]">
                <td className="px-4 py-3 text-ink-50">{name}</td>
                <td className="font-tabular px-4 py-3 text-status-overdue">
                  {formatCurrencyBRL(total)}
                </td>
              </tr>
            ))}
            {sortedCategoryTotals.length === 0 && (
              <tr>
                <td colSpan={2} className="px-4 py-8 text-center text-ink-500">
                  Nenhuma saída neste mês ainda.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <h2 className="mt-8 text-lg font-semibold text-ink-50">Lançamentos do mês</h2>
      <div className="mt-3 card-premium overflow-x-auto rounded-md">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-ink-700 bg-white/[0.03] text-left text-xs text-ink-300">
              <th className="px-4 py-3 font-medium">Data</th>
              <th className="px-4 py-3 font-medium">Descrição</th>
              <th className="px-4 py-3 font-medium">Categoria</th>
              <th className="px-4 py-3 font-medium">Origem</th>
              <th className="px-4 py-3 font-medium">Forma</th>
              <th className="px-4 py-3 font-medium">Valor</th>
              <th className="px-4 py-3 font-medium">Saldo acumulado</th>
            </tr>
          </thead>
          <tbody>
            {monthTransactions?.map((t) => (
              <tr
                key={t.id}
                className="border-b border-ink-700/70 last:border-0 hover:bg-white/[0.03]"
              >
                <td className="font-tabular px-4 py-3">
                  {new Date(t.date).toLocaleDateString("pt-BR")}
                </td>
                <td className="px-4 py-3">{t.description}</td>
                <td className="px-4 py-3">{t.cost_categories?.name ?? "—"}</td>
                <td className="px-4 py-3 text-xs text-ink-500">
                  {SOURCE_LABEL[t.source] ?? t.source}
                </td>
                <td className="px-4 py-3">{t.payment_method ?? "—"}</td>
                <td
                  className={`font-tabular px-4 py-3 font-medium ${
                    t.type === "entrada" ? "text-status-paid" : "text-status-overdue"
                  }`}
                >
                  {t.type === "entrada" ? "+" : "-"} {formatCurrencyBRL(t.amount)}
                </td>
                <td className="font-tabular px-4 py-3">{formatCurrencyBRL(t.running_balance)}</td>
              </tr>
            ))}
            {(!monthTransactions || monthTransactions.length === 0) && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-ink-500">
                  Nenhum lançamento neste mês ainda.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
