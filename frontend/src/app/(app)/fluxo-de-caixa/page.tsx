import Link from "next/link";
import { and, asc, eq, gte, isNull, lt, ne, or, sql } from "drizzle-orm";
import { requireUser } from "@/lib/auth/session";
import { withUser, sequential } from "@/lib/db";
import { cashTransactions, costCategories } from "@/lib/db/schema";
import { parseIsoDate, parseYearMonth } from "@/lib/validation";
import { formatCurrencyBRL } from "@shared/finance";
import { NewTransactionForm } from "./new-transaction-form";
import { MonthlyEvolutionChart } from "./monthly-evolution-chart";
import { PeriodSelector } from "./period-selector";
import { EvolutionRangeSelector } from "./evolution-range-selector";
import { variation, VariationBadge } from "@/components/ui/variation-badge";
import { ExportButton, type ExportRow } from "./export-button";

type TransactionRow = {
  id: string;
  date: string;
  description: string;
  category_id: string | null;
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
  opening: "Saldo inicial",
  asaas: "ASAAS",
  inter: "Inter PJ",
  api_sync: "Banco (sync)",
};

// Repasses entre as próprias contas da Be Fluent (ex: Asaas -> Inter)
// aparecem nos extratos de ambos os bancos — não são receita/despesa real,
// então ficam de fora dos totais para não contar em dobro, mas continuam
// visíveis na tabela de lançamentos para rastreabilidade.
const TRANSFER_CATEGORY_NAME = "Transferência entre Contas";

function addMonths(referenceMonth: string, delta: number): string {
  const [year, month] = referenceMonth.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1 + delta, 1)).toISOString().slice(0, 7);
}

function addDays(dateStr: string, delta: number): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

// Meses (YYYY-MM) exibidos no gráfico de evolução, do mais antigo ao mais
// recente. "6m"/"12m" são janelas corridas terminando no mês de referência;
// "ano" é o ano civil (janeiro a dezembro) do ano do mês de referência.
function evolutionMonths(referenceMonth: string, mode: string): string[] {
  if (mode === "ano") {
    const year = referenceMonth.slice(0, 4);
    return Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`);
  }
  const count = mode === "12m" ? 12 : 6;
  const [year, month] = referenceMonth.split("-").map(Number);
  return Array.from({ length: count }, (_, i) =>
    addMonths(`${year}-${String(month).padStart(2, "0")}`, -(count - 1 - i))
  );
}

export default async function FluxoDeCaixaPage({
  searchParams,
}: {
  searchParams: Promise<{ mes?: string; de?: string; ate?: string; evolucao?: string }>;
}) {
  const params = await searchParams;
  const mes = params.mes;
  const evolucao = params.evolucao;
  // Parâmetros de URL são entrada do usuário: datas malformadas são ignoradas.
  const de = parseIsoDate(params.de);
  const ate = parseIsoDate(params.ate);

  // Período customizado (de/ate) tem prioridade sobre a navegação por mês.
  const usingCustomPeriod = Boolean(de && ate);
  const referenceMonth = parseYearMonth(mes, new Date().toISOString().slice(0, 7));
  const nextMonth = addMonths(referenceMonth, 1);
  const previousMonth = addMonths(referenceMonth, -1);

  const periodStart = usingCustomPeriod ? de! : `${referenceMonth}-01`;
  const periodEnd = usingCustomPeriod ? addDays(ate!, 1) : `${nextMonth}-01`;

  let previousPeriodStart: string;
  let previousPeriodEnd: string;
  if (usingCustomPeriod) {
    const days = Math.round(
      (new Date(periodEnd).getTime() - new Date(periodStart).getTime()) / (1000 * 60 * 60 * 24)
    );
    previousPeriodEnd = periodStart;
    previousPeriodStart = addDays(periodStart, -days);
  } else {
    previousPeriodStart = `${previousMonth}-01`;
    previousPeriodEnd = `${referenceMonth}-01`;
  }

  const user = await requireUser();

  const evolutionMode = evolucao === "12m" || evolucao === "ano" ? evolucao : "6m";
  const evolutionMonthsList = evolutionMonths(referenceMonth, evolutionMode);
  const evolutionStart = `${evolutionMonthsList[0]}-01`;

  const notTransfer = and(
    or(isNull(costCategories.name), ne(costCategories.name, TRANSFER_CATEGORY_NAME)),
    ne(cashTransactions.source, "opening"),
  );

  const { periodTransactions, categories, yearTransactions, previousTotals } = await withUser(user.id, async (tx) => {
    const [period, categories, evolution, previous] = await sequential([
      () => // O saldo acumulado vem da view (janela sobre TODO o histórico); o filtro
      // de período é aplicado depois, () => então o saldo de cada linha é o real.
      tx.execute<TransactionRow & { category_name: string | null }>(sql`
        select v.id, v.date, v.created_at, v.description, v.category_id, v.amount, v.type,
               v.payment_method, v.running_balance, v.source, cc.name as category_name
          from public.cash_transactions_with_balance v
          left join public.cost_categories cc on cc.id = v.category_id
         where v.date >= ${periodStart}::date and v.date < ${periodEnd}::date
         order by v.date desc, v.created_at desc`),
      () => tx
        .select({ id: costCategories.id, name: costCategories.name, type: costCategories.type })
        .from(costCategories)
        .where(eq(costCategories.active, true))
        .orderBy(asc(costCategories.name)),
      () => tx
        .select({
          month: sql<string>`to_char(${cashTransactions.date}, 'YYYY-MM')`,
          type: cashTransactions.type,
          total: sql<number>`sum(${cashTransactions.amount})`.mapWith(Number),
        })
        .from(cashTransactions)
        .leftJoin(costCategories, eq(costCategories.id, cashTransactions.categoryId))
        .where(and(gte(cashTransactions.date, evolutionStart), notTransfer))
        .groupBy(sql`1`, cashTransactions.type),
      () => tx
        .select({
          type: cashTransactions.type,
          total: sql<number>`sum(${cashTransactions.amount})`.mapWith(Number),
        })
        .from(cashTransactions)
        .leftJoin(costCategories, eq(costCategories.id, cashTransactions.categoryId))
        .where(and(gte(cashTransactions.date, previousPeriodStart), lt(cashTransactions.date, previousPeriodEnd), notTransfer))
        .groupBy(cashTransactions.type),
    ]);

    const previousTotals = { entrada: 0, saida: 0 };
    for (const row of previous) previousTotals[row.type] = row.total;

    return {
      periodTransactions: period.rows.map(
        (r): TransactionRow => ({
          id: r.id,
          date: r.date,
          description: r.description,
          category_id: r.category_id,
          amount: Number(r.amount),
          type: r.type,
          payment_method: r.payment_method,
          running_balance: Number(r.running_balance),
          source: r.source,
          cost_categories: r.category_name ? { name: r.category_name } : null,
        })
      ),
      categories,
      yearTransactions: evolution,
      previousTotals,
    };
  });

  const nonTransferTransactions = periodTransactions.filter(
    (t) => t.cost_categories?.name !== TRANSFER_CATEGORY_NAME && t.source !== "opening"
  );

  const totals = nonTransferTransactions.reduce(
    (acc, t) => {
      acc[t.type] += t.amount;
      return acc;
    },
    { entrada: 0, saida: 0 }
  );

  // running_balance da view já inclui transferências (é um saldo bancário
  // real, não um "resultado do negócio") — mantido como está, só os totais
  // de entrada/saída do card e o resumo por categoria excluem transferências.
  const currentBalance = periodTransactions[0]?.running_balance ?? 0;
  const previousBalance = currentBalance - totals.entrada + totals.saida;

  const monthlyTotals = evolutionMonthsList.map((month) => ({
    month,
    entrada: yearTransactions.find((r) => r.month === month && r.type === "entrada")?.total ?? 0,
    saida: yearTransactions.find((r) => r.month === month && r.type === "saida")?.total ?? 0,
  }));

  const categoryTotals = new Map<string, number>();
  for (const t of periodTransactions) {
    if (t.type !== "saida") continue;
    const name = t.cost_categories?.name ?? "Sem categoria";
    categoryTotals.set(name, (categoryTotals.get(name) ?? 0) + t.amount);
  }
  const sortedCategoryTotals = Array.from(categoryTotals.entries()).sort((a, b) => b[1] - a[1]);

  const periodLabel = usingCustomPeriod
    ? `${new Date(de! + "T00:00:00").toLocaleDateString("pt-BR")} — ${new Date(ate! + "T00:00:00").toLocaleDateString("pt-BR")}`
    : new Date(`${referenceMonth}-01`).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });

  const exportRows: ExportRow[] = periodTransactions.map((t) => ({
    date: t.date,
    description: t.description,
    category: t.cost_categories?.name ?? null,
    source: t.source,
    type: t.type,
    amount: t.amount,
    running_balance: t.running_balance,
  }));

  return (
    <div>
      {/* Linha 1: navegação de mês + novo lançamento */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          {!usingCustomPeriod && (
            <>
              <Link
                href={`/fluxo-de-caixa?mes=${previousMonth}`}
                className="rounded-md px-2 py-1 text-sm text-ink-300 hover:bg-white/[0.05] hover:text-ink-50"
              >
                ‹
              </Link>
              <p className="text-sm capitalize text-ink-300">{periodLabel}</p>
              <Link
                href={`/fluxo-de-caixa?mes=${nextMonth}`}
                className="rounded-md px-2 py-1 text-sm text-ink-300 hover:bg-white/[0.05] hover:text-ink-50"
              >
                ›
              </Link>
            </>
          )}
          {usingCustomPeriod && <p className="text-sm text-ink-300">{periodLabel}</p>}
        </div>
        <NewTransactionForm categories={categories} />
      </div>

      {/* Linha 2: seletor de período (sempre visível) */}
      <div className="mt-3">
        <PeriodSelector />
      </div>

      <div className="mt-4 rounded-md border border-amber-500/20 bg-amber-500/[0.06] px-4 py-3 text-xs text-ink-300">
        Este saldo reflete só o que já foi confirmado em extrato bancário importado. Mensalidades
        marcadas como pagas em Mensalidades só aparecem aqui depois de importadas em Conciliação
        Bancária.
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-md border border-ink-700 bg-status-paid-bg p-4">
          <p className="text-sm text-status-paid">Entradas no período</p>
          <p className="font-display font-tabular text-xl font-bold text-status-paid">
            {formatCurrencyBRL(totals.entrada)}
          </p>
          <VariationBadge value={variation(totals.entrada, previousTotals.entrada)} />
        </div>
        <div className="rounded-md border border-ink-700 bg-status-overdue-bg p-4">
          <p className="text-sm text-status-overdue">Saídas no período</p>
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

      <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-lg font-semibold text-ink-50">
          Evolução (
          {evolutionMode === "ano"
            ? `ano civil ${referenceMonth.slice(0, 4)}`
            : evolutionMode === "12m"
              ? "últimos 12 meses"
              : "últimos 6 meses"}
          )
        </h2>
        <EvolutionRangeSelector />
      </div>
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
                  Nenhuma saída neste período ainda.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-8 flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-ink-50">Lançamentos do período</h2>
        <ExportButton rows={exportRows} periodLabel={periodLabel} />
      </div>
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
              <th className="px-4 py-3 font-medium">Ação</th>
            </tr>
          </thead>
          <tbody>
            {periodTransactions?.map((t) => (
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
                <td className="px-4 py-3">
                  <NewTransactionForm
                    categories={categories}
                    transaction={{
                      id: t.id,
                      date: t.date,
                      description: t.description,
                      category_id: t.category_id,
                      amount: t.amount,
                      type: t.type,
                      payment_method: t.payment_method,
                    }}
                    trigger={
                      <span className="rounded-md bg-white/[0.06] px-3 py-1 text-xs font-semibold text-ink-100 hover:bg-white/[0.1]">
                        Editar
                      </span>
                    }
                  />
                </td>
              </tr>
            ))}
            {(!periodTransactions || periodTransactions.length === 0) && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-ink-500">
                  Nenhum lançamento neste período ainda.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
