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

export default async function DashboardPage() {
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

  const referenceMonth = new Date().toISOString().slice(0, 7) + "-01";
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

  return (
    <div>
      <p className="text-sm text-ink-300">Visão executiva em tempo real.</p>

      {/* Inadimplência sobe para o topo em mobile — é o motivo mais comum de
          checar o app pelo celular fora do escritório. */}
      <div className="mt-6 md:hidden">
        <KpiCard
          label="Inadimplência"
          value={formatCurrencyBRL(inadimplenciaTotal)}
          hint={`${faturasAtrasadas} fatura(s) em atraso`}
          tone={inadimplenciaTotal > 0 ? "negative" : "positive"}
        />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 [grid-template-columns:repeat(auto-fit,minmax(220px,1fr))]">
        <KpiCard label="MRR" value={formatCurrencyBRL(mrr)} hint="Receita recorrente mensal" />
        <div className="hidden md:block">
          <KpiCard
            label="Inadimplência"
            value={formatCurrencyBRL(inadimplenciaTotal)}
            hint={`${faturasAtrasadas} fatura(s) em atraso`}
            tone={inadimplenciaTotal > 0 ? "negative" : "positive"}
          />
        </div>
        <KpiCard
          label="Ticket médio"
          value={formatCurrencyBRL(ticketMedioGeral)}
          hint={`${totalActiveStudents} aluno(s) ativo(s)`}
        />
        {canViewNetProfit && (
          <KpiCard
            label="Lucro líquido (mês)"
            value={formatCurrencyBRL(mrr - (cacData?.marketing_spend ?? 0))}
            hint="MRR menos custos de marketing do mês"
          />
        )}
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
        </table>
      </div>

      <h2 className="mt-8 text-lg font-semibold text-ink-50">Insights</h2>
      <div className="mt-3">
        <AiInsightsCard />
      </div>
    </div>
  );
}
