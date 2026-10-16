import { todayBR, formatMonthBR } from "@/lib/dates";
import { and, asc, eq, gte, isNotNull, lt, lte, ne, or, isNull, sql, sum } from "drizzle-orm";
import { formatCurrencyBRL } from "@shared/finance";
import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { Policies } from "@/lib/auth/policies";
import { withUser, sequential } from "@/lib/db";
import { cashTransactions, costCategories, invoices, studentTargets, tasks } from "@/lib/db/schema";
import {
  countActiveEnrollments,
  getCacForMonth,
  getInadimplencia,
  getMonthTargets,
  getMrr,
  getTicketByPlan,
} from "@/lib/queries/kpis";
import { getPayablesOpen, getReceivablesOpen, getSimplesApuracao } from "@/lib/queries/finance";
import { parseYearMonth } from "@/lib/validation";
import { KpiCard } from "@/components/ui/kpi-card";
import { LtvCacHealth } from "@/components/ui/ltv-cac-health";
import { ProgressBar } from "@/components/ui/progress-bar";
import { AiInsightsCard } from "@/components/ui/ai-insights-card";

// Repasses entre as próprias contas da Be Fluent não são receita/despesa
// real — mesmo critério já usado no Fluxo de Caixa para não inflar totais.
const TRANSFER_CATEGORY_NAME = "Transferência entre Contas";

function addMonths(referenceMonth: string, delta: number): string {
  const [year, month] = referenceMonth.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1 + delta, 1)).toISOString().slice(0, 7);
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ mes?: string }>;
}) {
  const { mes } = await searchParams;
  const user = await requireUser();

  const canViewNetProfit = Policies.viewNetProfit.check(user);

  const currentMonth = todayBR().slice(0, 7);
  const selectedMonth = parseYearMonth(mes, currentMonth);
  const isCurrentMonth = selectedMonth === currentMonth;
  const referenceMonth = `${selectedMonth}-01`;
  const previousMonthValue = addMonths(selectedMonth, -1);
  const nextMonthValue = addMonths(selectedMonth, 1);

  const taskAlertThreshold = new Date();
  taskAlertThreshold.setDate(taskAlertThreshold.getDate() + 3);
  const taskAlertThresholdStr = taskAlertThreshold.toISOString().slice(0, 10);

  const notTransfer = and(
    or(isNull(costCategories.name), ne(costCategories.name, TRANSFER_CATEGORY_NAME)),
    ne(cashTransactions.source, "opening")
  );

  const {
    mrr,
    ticketData,
    cacData,
    inadimplencia,
    targets,
    totalStudentTarget,
    activeStudentsTotal,
    upcomingTasks,
    caixaDisponivel,
    saldoTotalCaixa,
    aReceberCartao,
    recvOpen,
    payOpen,
    dasApuracao,
  } = await withUser(user.id, async (tx) => {
    const [
      mrr,
      ticketData,
      cacData,
      inadimplencia,
      targets,
      [studentTargetSum],
      activeStudentsTotal,
      upcomingTasks,
      [monthIncome],
      [balance],
      [cardPaid],
      recvOpen,
      payOpen,
      dasApuracao,
    ] = await sequential([
      () => getMrr(tx),
      () => getTicketByPlan(tx),
      () => getCacForMonth(tx, referenceMonth),
      () => getInadimplencia(tx),
      () => getMonthTargets(tx, referenceMonth),
      () => tx
        .select({ total: sum(studentTargets.targetCount).mapWith(Number) })
        .from(studentTargets)
        .where(eq(studentTargets.referenceMonth, referenceMonth)),
      () => countActiveEnrollments(tx),
      () => tx
        .select({ id: tasks.id, title: tasks.title, due_date: tasks.dueDate })
        .from(tasks)
        .where(and(eq(tasks.completed, false), lte(tasks.dueDate, taskAlertThresholdStr)))
        .orderBy(asc(tasks.dueDate)),
      () => // Caixa disponível: entradas já confirmadas em extrato bancário no mês selecionado.
      tx
        .select({ total: sum(cashTransactions.amount).mapWith(Number) })
        .from(cashTransactions)
        .leftJoin(costCategories, eq(costCategories.id, cashTransactions.categoryId))
        .where(
          and(
            eq(cashTransactions.type, "entrada"),
            gte(cashTransactions.date, referenceMonth),
            lt(cashTransactions.date, `${nextMonthValue}-01`),
            notTransfer
          )
        ),
      // Saldo total de hoje: mesmo cálculo do Fluxo de Caixa (ancorado no saldo inicial).
      async () => {
        const { rows } = await tx.execute<{ total: string }>(sql`
          select running_balance as total from public.cash_transactions_with_balance
           where in_balance order by seq desc limit 1`);
        return rows.map((row) => ({ total: Number(row.total) }));
      },
      () => // A receber: mensalidades pagas com cartão no mês selecionado — o
      // dinheiro só conta como "caixa disponível" quando confirmado num
      // extrato importado (categoria "Mensalidade de Aluno"), () => não estimamos prazo.
      tx
        .select({ total: sum(invoices.totalPaid).mapWith(Number) })
        .from(invoices)
        .where(
          and(
            eq(invoices.paymentMethod, "cartao"),
            isNotNull(invoices.paidDate),
            gte(invoices.paidDate, referenceMonth),
            lt(invoices.paidDate, `${nextMonthValue}-01`)
          )
        ),
      () => getReceivablesOpen(tx),
      () => getPayablesOpen(tx),
      // DAS da competência fechada (mês anterior ao corrente) — é o imposto
      // que efetivamente se paga agora.
      () => getSimplesApuracao(tx, `${addMonths(currentMonth, -1)}-01`),
    ]);
    return {
      mrr,
      ticketData,
      cacData,
      inadimplencia,
      targets,
      totalStudentTarget: studentTargetSum?.total ?? 0,
      activeStudentsTotal,
      upcomingTasks,
      caixaDisponivel: monthIncome?.total ?? 0,
      saldoTotalCaixa: balance?.total ?? 0,
      aReceberCartao: cardPaid?.total ?? 0,
      recvOpen,
      payOpen,
      dasApuracao,
    };
  });

  const revenueTarget = targets.revenueTarget != null ? { target_amount: targets.revenueTarget } : null;
  const cacTarget = targets.maxCac != null ? { max_cac: targets.maxCac } : null;
  const ltvCacTarget = targets.minLtvCacRatio != null ? { min_ratio: targets.minLtvCacRatio } : null;

  const plansWithStudents = ticketData.filter((p) => p.active_students > 0);
  const totalActiveStudents = plansWithStudents.reduce((sum, p) => sum + p.active_students, 0);
  const ticketMedioGeral = totalActiveStudents > 0 ? mrr / totalActiveStudents : 0;
  const ltvMedioGeral =
    plansWithStudents.length > 0
      ? plansWithStudents.reduce((sum, p) => sum + p.ltv_medio * p.active_students, 0) /
        Math.max(1, totalActiveStudents)
      : 0;
  const cac = cacData?.cac ?? 0;

  const inadimplenciaTotal = inadimplencia.total_atrasado;
  const faturasAtrasadas = inadimplencia.faturas_atrasadas;

  const todayStr = todayBR();
  const tasksOverdue = upcomingTasks.filter((t) => t.due_date < todayStr).length;
  const tasksDueSoon = upcomingTasks.length;

  const ticketTotals = plansWithStudents.reduce(
    (acc, p) => {
      acc.students += p.active_students;
      acc.ticket += p.ticket_medio * p.active_students;
      acc.ltv += p.ltv_medio * p.active_students;
      return acc;
    },
    { students: 0, ticket: 0, ltv: 0 }
  );

  return (
    <div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-ink-300">Visão executiva em tempo real.</p>
        <div className="flex items-center gap-3">
          <Link
            href={`/dashboard?mes=${previousMonthValue}`}
            className="rounded-md px-2 py-1 text-sm text-ink-300 hover:bg-white/[0.05] hover:text-ink-50"
          >
            ‹
          </Link>
          <p className="text-sm capitalize text-ink-300">
            {formatMonthBR(selectedMonth)}
          </p>
          <Link
            href={`/dashboard?mes=${nextMonthValue}`}
            className="rounded-md px-2 py-1 text-sm text-ink-300 hover:bg-white/[0.05] hover:text-ink-50"
          >
            ›
          </Link>
          {!isCurrentMonth && (
            <Link href="/dashboard" className="text-xs text-amber-400 hover:text-amber-300">
              Voltar ao mês atual
            </Link>
          )}
        </div>
      </div>

      {!isCurrentMonth && (
        <div className="mt-3 rounded-md border border-amber-500/20 bg-amber-500/[0.06] px-4 py-3 text-xs text-ink-300">
          Mostrando dados de {formatMonthBR(selectedMonth)}.
          Os valores que são &quot;foto de agora&quot; (Saldo total em caixa) sempre refletem o
          momento atual, não o mês selecionado — só os indicadores &quot;do mês&quot; mudam.
        </div>
      )}

      <h2 className="mt-6 text-lg font-semibold text-ink-50">Caixa</h2>
      <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KpiCard
          label="Caixa disponível (mês)"
          value={formatCurrencyBRL(caixaDisponivel)}
          hint="Já confirmado em extrato bancário"
          explanation="Soma das entradas já confirmadas em extrato bancário importado neste mês, excluindo transferências entre contas próprias. É dinheiro que já está de fato na conta."
          tone="positive"
        />
        <KpiCard
          label="A receber (mensalidades no cartão)"
          value={formatCurrencyBRL(aReceberCartao)}
          hint="Aluno pagou, aguardando confirmação no extrato"
          explanation="Mensalidades deste mês pagas com cartão de crédito, já marcadas como pagas em Mensalidades, mas ainda não confirmadas em nenhum extrato importado — o valor exato e a data de queda dependem do repasse do gateway."
          tone="warning"
        />
        <KpiCard
          label="Saldo total em caixa"
          value={formatCurrencyBRL(saldoTotalCaixa)}
          hint="Todo o histórico de extratos importados"
          explanation="Soma de todas as entradas menos todas as saídas já confirmadas em extrato, desde o início — é o mesmo saldo acumulado exibido em Fluxo de Caixa."
        />
      </div>

      {tasksDueSoon > 0 && (
        <Link href="/tarefas" className="mt-4 block">
          <KpiCard
            label="Tarefas próximas"
            value={`${tasksDueSoon} tarefa(s)`}
            hint={
              tasksOverdue > 0
                ? `${tasksOverdue} atrasada(s) — clique para ver`
                : "Vencem nos próximos 3 dias — clique para ver"
            }
            tone={tasksOverdue > 0 ? "negative" : "warning"}
          />
        </Link>
      )}

      <h2 className="mt-8 text-lg font-semibold text-ink-50">Posição financeira</h2>
      <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Link href="/contas" className="block">
          <KpiCard
            label="A receber em aberto"
            value={formatCurrencyBRL(recvOpen.overdue.total + recvOpen.upcoming.total)}
            hint={`${formatCurrencyBRL(recvOpen.overdue.total)} vencido · clique para ver`}
            tone="positive"
          />
        </Link>
        <Link href="/contas" className="block">
          <KpiCard
            label="A pagar em aberto"
            value={formatCurrencyBRL(payOpen.overdue.total + payOpen.upcoming.total)}
            hint={`${formatCurrencyBRL(payOpen.overdue.total)} vencido · clique para ver`}
            tone="negative"
          />
        </Link>
        <Link href="/contas" className="block">
          <KpiCard
            label="Saldo projetado"
            value={formatCurrencyBRL(
              recvOpen.overdue.total + recvOpen.upcoming.total - (payOpen.overdue.total + payOpen.upcoming.total)
            )}
            hint="A receber menos a pagar"
            tone={
              recvOpen.overdue.total + recvOpen.upcoming.total - (payOpen.overdue.total + payOpen.upcoming.total) >= 0
                ? "positive"
                : "negative"
            }
          />
        </Link>
        {canViewNetProfit && (
          <Link href="/impostos" className="block">
            <KpiCard
              label="DAS a pagar (Simples)"
              value={dasApuracao ? formatCurrencyBRL(dasApuracao.das) : "—"}
              hint={
                dasApuracao?.faixa
                  ? `Competência fechada · alíquota ${(dasApuracao.effective_rate * 100).toFixed(2)}%`
                  : "Sem receita na competência"
              }
              explanation="Imposto do Simples Nacional (Anexo III) da competência fechada, lançado automaticamente em Contas a Pagar na virada do mês."
              tone="warning"
            />
          </Link>
        )}
      </div>

      <h2 className="mt-8 text-lg font-semibold text-ink-50">Indicadores do mês</h2>
      <div className="mt-3 grid grid-cols-1 gap-4 [grid-template-columns:repeat(auto-fit,minmax(220px,1fr))]">
        <KpiCard
          label="Inadimplência"
          value={formatCurrencyBRL(inadimplenciaTotal)}
          hint={`${faturasAtrasadas} fatura(s) em atraso`}
          explanation="Soma das mensalidades com vencimento já passado e ainda não pagas, em qualquer mês (não só o atual)."
          tone={inadimplenciaTotal > 0 ? "negative" : "positive"}
          className="order-first sm:order-none"
        />
        <KpiCard
          label="MRR"
          value={formatCurrencyBRL(mrr)}
          hint="Receita recorrente mensal"
          explanation="Soma das mensalidades de todos os alunos com matrícula ativa — é um valor contratual (o que deveria entrar todo mês), não o que já caiu na conta."
        />
        <KpiCard
          label="Ticket médio"
          value={formatCurrencyBRL(ticketMedioGeral)}
          hint={`${totalActiveStudents} aluno(s) ativo(s)`}
          explanation="MRR dividido pelo número de alunos ativos — quanto cada aluno paga, em média, por mês."
        />
        {canViewNetProfit && (
          <KpiCard
            label="Lucro líquido (mês)"
            value={formatCurrencyBRL(mrr - (cacData?.marketing_spend ?? 0))}
            hint="MRR menos custos de marketing do mês"
            explanation="Estimativa contratual: MRR menos o gasto de marketing lançado no fluxo de caixa este mês. Não subtrai outros custos (professores, taxas, etc) — para o resultado real, consulte o Fluxo de Caixa."
          />
        )}
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <LtvCacHealth ltv={ltvMedioGeral} cac={cac} minRatioTarget={ltvCacTarget?.min_ratio} />
        <KpiCard
          label="CAC (mês)"
          value={cac > 0 ? formatCurrencyBRL(cac) : "—"}
          hint={
            cacData
              ? `${cacData.new_students} aluno(s) novo(s) neste mês${
                  cacTarget?.max_cac != null ? ` · meta máx. ${formatCurrencyBRL(cacTarget.max_cac)}` : ""
                }`
              : "Sem gasto de marketing lançado neste mês"
          }
          explanation="Custo de Aquisição de Cliente: gasto em Marketing e Vendas este mês, dividido pelo número de alunos novos no mesmo período."
          tone={
            cacTarget?.max_cac != null && cac > cacTarget.max_cac
              ? "negative"
              : undefined
          }
        />
      </div>

      <h2 className="mt-8 text-lg font-semibold text-ink-50">Metas do mês</h2>
      <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <ProgressBar
          label="Meta de faturamento"
          current={mrr}
          target={revenueTarget?.target_amount ?? 0}
          formatValue={formatCurrencyBRL}
          remainingLabel={(remaining) => `Faltam ${formatCurrencyBRL(remaining)} para bater a meta.`}
        />
        <ProgressBar
          label="Meta de alunos"
          current={activeStudentsTotal}
          target={totalStudentTarget}
          formatValue={(v) => `${v} aluno(s)`}
          remainingLabel={(remaining) => `Faltam ${remaining} aluno(s) para bater a meta.`}
        />
      </div>
      {(cacTarget?.max_cac != null || ltvCacTarget?.min_ratio != null) && (
        <div className="mt-3 flex flex-wrap gap-4 text-xs text-ink-300">
          {cacTarget?.max_cac != null && (
            <span>
              CAC máx. da meta:{" "}
              <strong className={cac > cacTarget.max_cac ? "text-status-overdue" : "text-status-paid"}>
                {formatCurrencyBRL(cacTarget.max_cac)}
              </strong>{" "}
              {cac > cacTarget.max_cac ? "(acima da meta)" : "(dentro da meta)"}
            </span>
          )}
          {ltvCacTarget?.min_ratio != null && (
            <span>
              LTV:CAC mín. da meta:{" "}
              <strong className="text-ink-50">{ltvCacTarget.min_ratio.toFixed(1)}:1</strong>
            </span>
          )}
        </div>
      )}

      <h2 className="mt-8 text-lg font-semibold text-ink-50">Ticket médio e LTV por plano</h2>
      <div className="mt-3 card-premium overflow-x-auto rounded-md">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-ink-700 bg-white/[0.03] text-left text-xs text-ink-300">
              <th className="px-4 py-3 font-medium">Plano</th>
              <th className="px-4 py-3 font-medium">Alunos ativos</th>
              <th className="px-4 py-3 font-medium">Ticket médio</th>
              <th className="px-4 py-3 font-medium">LTV médio</th>
            </tr>
          </thead>
          <tbody>
            {ticketData.map((plan) => (
              <tr
                key={plan.plan_id}
                className="border-b border-ink-700/70 last:border-0 hover:bg-white/[0.03]"
              >
                <td className="px-4 py-3 font-medium text-ink-50">{plan.plan_name}</td>
                <td className="font-tabular px-4 py-3">{plan.active_students}</td>
                <td className="font-tabular px-4 py-3">
                  {plan.active_students > 0 ? formatCurrencyBRL(plan.ticket_medio) : "—"}
                </td>
                <td className="font-tabular px-4 py-3">
                  {plan.active_students > 0 ? formatCurrencyBRL(plan.ltv_medio) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
          {ticketTotals.students > 0 && (
            <tfoot>
              <tr className="border-t border-ink-700 bg-white/[0.03] font-semibold text-ink-50">
                <td className="px-4 py-3">Total</td>
                <td className="font-tabular px-4 py-3">{ticketTotals.students}</td>
                <td className="font-tabular px-4 py-3">
                  {formatCurrencyBRL(ticketTotals.ticket / ticketTotals.students)}
                </td>
                <td className="font-tabular px-4 py-3">
                  {formatCurrencyBRL(ticketTotals.ltv / ticketTotals.students)}
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      <h2 className="mt-8 text-lg font-semibold text-ink-50">Insights</h2>
      <div className="mt-3">
        <AiInsightsCard />
      </div>
    </div>
  );
}
