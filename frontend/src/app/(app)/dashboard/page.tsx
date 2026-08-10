import { createClient } from "@/lib/supabase/server";
import { formatCurrencyBRL } from "@shared/finance";
import Link from "next/link";
import { KpiCard } from "@/components/ui/kpi-card";
import { LtvCacHealth } from "@/components/ui/ltv-cac-health";
import { ProgressBar } from "@/components/ui/progress-bar";
import { AiInsightsCard } from "@/components/ui/ai-insights-card";

type PlanTicket = {
  plan_id: string;
  plan_name: string;
  active_students: number;
  ticket_medio: number;
  ltv_medio: number;
};

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
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user!.id)
    .single();

  const canViewNetProfit = profile?.role === "owner";

  const currentMonth = new Date().toISOString().slice(0, 7);
  const selectedMonth = mes ?? currentMonth;
  const isCurrentMonth = selectedMonth === currentMonth;
  const referenceMonth = `${selectedMonth}-01`;
  const previousMonthValue = addMonths(selectedMonth, -1);
  const nextMonthValue = addMonths(selectedMonth, 1);

  const taskAlertThreshold = new Date();
  taskAlertThreshold.setDate(taskAlertThreshold.getDate() + 3);
  const taskAlertThresholdStr = taskAlertThreshold.toISOString().slice(0, 10);

  const [
    { data: mrrData },
    { data: ticketData },
    { data: cacData },
    { data: inadimplenciaData },
    { data: revenueTarget },
    { data: studentTargets },
    { count: activeEnrollmentsCount },
    { data: cacTarget },
    { data: ltvCacTarget },
    { data: upcomingTasks },
    { data: monthCashTransactions },
    { data: allCashTransactions },
    { data: cardPaidInvoices },
  ] = await Promise.all([
    supabase.from("v_mrr").select("mrr").single(),
    supabase.from("v_ticket_medio_por_plano").select("*").returns<PlanTicket[]>(),
    supabase
      .from("v_cac_by_month")
      .select("*")
      .eq("reference_month", referenceMonth)
      .maybeSingle(),
    supabase.from("v_inadimplencia_atual").select("*").single(),
    supabase
      .from("revenue_targets")
      .select("target_amount")
      .eq("reference_month", referenceMonth)
      .maybeSingle(),
    supabase
      .from("student_targets")
      .select("target_count")
      .eq("reference_month", referenceMonth),
    supabase.from("enrollments").select("id", { count: "exact", head: true }).eq("status", "active"),
    supabase
      .from("cac_targets")
      .select("max_cac")
      .eq("reference_month", referenceMonth)
      .maybeSingle(),
    supabase
      .from("ltv_cac_targets")
      .select("min_ratio")
      .eq("reference_month", referenceMonth)
      .maybeSingle(),
    supabase
      .from("tasks")
      .select("id, title, due_date")
      .eq("completed", false)
      .lte("due_date", taskAlertThresholdStr)
      .order("due_date"),
    // Caixa disponível: entradas já confirmadas em extrato bancário no mês selecionado.
    supabase
      .from("cash_transactions")
      .select("amount, type, cost_categories(name)")
      .gte("date", referenceMonth)
      .lt("date", `${nextMonthValue}-01`)
      .returns<{ amount: number; type: "entrada" | "saida"; cost_categories: { name: string } | null }[]>(),
    // Saldo total: todo o histórico de cash_transactions, sem filtro de mês
    // — sempre reflete o momento atual, não o mês selecionado.
    supabase
      .from("cash_transactions")
      .select("amount, type")
      .returns<{ amount: number; type: "entrada" | "saida" }[]>(),
    // A receber: mensalidades pagas com cartão no mês selecionado — o
    // dinheiro só conta como "caixa disponível" quando confirmado num
    // extrato importado (categoria "Mensalidade de Aluno"), não estimamos prazo.
    supabase
      .from("invoices")
      .select("total_paid, paid_date")
      .eq("payment_method", "cartao")
      .not("paid_date", "is", null)
      .gte("paid_date", referenceMonth)
      .lt("paid_date", `${nextMonthValue}-01`),
  ]);

  const mrr = mrrData?.mrr ?? 0;
  const plansWithStudents = (ticketData ?? []).filter((p) => p.active_students > 0);
  const totalActiveStudents = plansWithStudents.reduce((sum, p) => sum + p.active_students, 0);
  const ticketMedioGeral = totalActiveStudents > 0 ? mrr / totalActiveStudents : 0;
  const ltvMedioGeral =
    plansWithStudents.length > 0
      ? plansWithStudents.reduce((sum, p) => sum + p.ltv_medio * p.active_students, 0) /
        Math.max(1, totalActiveStudents)
      : 0;
  const cac = cacData?.cac ?? 0;

  const totalStudentTarget = (studentTargets ?? []).reduce(
    (sum, t) => sum + t.target_count,
    0
  );
  const activeStudentsTotal = activeEnrollmentsCount ?? 0;

  const inadimplenciaTotal = inadimplenciaData?.total_atrasado ?? 0;
  const faturasAtrasadas = inadimplenciaData?.faturas_atrasadas ?? 0;

  const todayStr = new Date().toISOString().slice(0, 10);
  const tasksOverdue = (upcomingTasks ?? []).filter((t) => t.due_date < todayStr).length;
  const tasksDueSoon = (upcomingTasks ?? []).length;

  const caixaDisponivel = (monthCashTransactions ?? [])
    .filter((t) => t.type === "entrada" && t.cost_categories?.name !== TRANSFER_CATEGORY_NAME)
    .reduce((sum, t) => sum + t.amount, 0);

  const saldoTotalCaixa = (allCashTransactions ?? []).reduce(
    (sum, t) => sum + (t.type === "entrada" ? t.amount : -t.amount),
    0
  );

  const aReceberCartao = (cardPaidInvoices ?? []).reduce(
    (sum, inv) => sum + (inv.total_paid ?? 0),
    0
  );

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
            {new Date(`${selectedMonth}-01`).toLocaleDateString("pt-BR", {
              month: "long",
              year: "numeric",
            })}
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
          Mostrando dados de {new Date(`${selectedMonth}-01`).toLocaleDateString("pt-BR", { month: "long", year: "numeric" })}.
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
            {(ticketData ?? []).map((plan) => (
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
