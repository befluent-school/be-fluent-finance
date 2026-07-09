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
  cost_categories: { name: string } | null;
};

function monthsAgo(n: number): string {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - n);
  return d.toISOString().slice(0, 7);
}

export default async function FluxoDeCaixaPage({
  searchParams,
}: {
  searchParams: Promise<{ mes?: string }>;
}) {
  const { mes } = await searchParams;
  const referenceMonth = mes ?? new Date().toISOString().slice(0, 7);
  const nextMonth = (() => {
    const [year, month] = referenceMonth.split("-").map(Number);
    return new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 7);
  })();

  const supabase = await createClient();

  const [{ data: monthTransactions }, { data: categories }, { data: yearTransactions }] =
    await Promise.all([
      supabase
        .from("cash_transactions_with_balance")
        .select(
          "id, date, created_at, description, amount, type, payment_method, running_balance, cost_categories(name)"
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
    ]);

  const totals = (monthTransactions ?? []).reduce(
    (acc, t) => {
      acc[t.type] += t.amount;
      return acc;
    },
    { entrada: 0, saida: 0 }
  );

  const currentBalance = monthTransactions?.[0]?.running_balance ?? 0;

  const monthlyTotals = Array.from({ length: 6 }, (_, i) => monthsAgo(5 - i)).map((month) => {
    const entrada = (yearTransactions ?? [])
      .filter((t) => t.date.startsWith(month) && t.type === "entrada")
      .reduce((sum, t) => sum + t.amount, 0);
    const saida = (yearTransactions ?? [])
      .filter((t) => t.date.startsWith(month) && t.type === "saida")
      .reduce((sum, t) => sum + t.amount, 0);
    return { month, entrada, saida };
  });

  return (
    <div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-ink-300">
          {new Date(`${referenceMonth}-01`).toLocaleDateString("pt-BR", {
            month: "long",
            year: "numeric",
          })}
        </p>
        <NewTransactionForm categories={categories ?? []} />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-md border border-ink-700 bg-status-paid-bg p-4">
          <p className="text-sm text-status-paid">Entradas no mês</p>
          <p className="font-display font-tabular text-xl font-bold text-status-paid">
            {formatCurrencyBRL(totals.entrada)}
          </p>
        </div>
        <div className="rounded-md border border-ink-700 bg-status-overdue-bg p-4">
          <p className="text-sm text-status-overdue">Saídas no mês</p>
          <p className="font-display font-tabular text-xl font-bold text-status-overdue">
            {formatCurrencyBRL(totals.saida)}
          </p>
        </div>
        <div className="rounded-md border border-ink-700 bg-ink-800/40 p-4">
          <p className="text-sm text-ink-300">Saldo acumulado</p>
          <p className="font-display font-tabular text-xl font-bold text-ink-50">
            {formatCurrencyBRL(currentBalance)}
          </p>
        </div>
      </div>

      <h2 className="mt-8 text-lg font-semibold text-ink-50">
        Evolução (últimos 6 meses)
      </h2>
      <div className="mt-3">
        <MonthlyEvolutionChart data={monthlyTotals} />
      </div>

      <h2 className="mt-8 text-lg font-semibold text-ink-50">Lançamentos do mês</h2>
      <div className="mt-3 card-premium overflow-x-auto rounded-md">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-ink-700 bg-white/[0.03] text-left text-xs text-ink-300">
              <th className="px-4 py-3 font-medium">Data</th>
              <th className="px-4 py-3 font-medium">Descrição</th>
              <th className="px-4 py-3 font-medium">Categoria</th>
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
                <td colSpan={6} className="px-4 py-8 text-center text-ink-500">
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
