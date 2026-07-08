import { createClient } from "@/lib/supabase/server";
import { calculatePlanLtv, formatCurrencyBRL } from "@shared/finance";
import type { Plan } from "@shared/types";
import { PlanForm } from "./plan-form";

export default async function PlanosPage() {
  const supabase = await createClient();
  const { data: plans } = await supabase
    .from("plans")
    .select("*")
    .order("monthly_value", { ascending: true })
    .returns<Plan[]>();

  return (
    <div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-ink-300">
          Mentoria individual — LTV estimado com base na mensalidade e duração média.
        </p>
        <PlanForm />
      </div>

      <div className="mt-6 card-premium overflow-x-auto rounded-md">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-ink-700 bg-white/[0.03] text-left text-xs text-ink-300">
              <th className="px-4 py-3 font-medium">Plano</th>
              <th className="px-4 py-3 font-medium">Aulas/semana</th>
              <th className="px-4 py-3 font-medium">Mensalidade</th>
              <th className="px-4 py-3 font-medium">Duração média</th>
              <th className="px-4 py-3 font-medium">LTV estimado</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Ação</th>
            </tr>
          </thead>
          <tbody>
            {plans?.map((plan) => (
              <tr key={plan.id} className="border-b border-ink-700/70 last:border-0 hover:bg-white/[0.03]">
                <td className="px-4 py-3 font-medium text-ink-50">{plan.name}</td>
                <td className="font-tabular px-4 py-3">{plan.lessons_per_week}x</td>
                <td className="font-tabular px-4 py-3">
                  {formatCurrencyBRL(plan.monthly_value)}
                </td>
                <td className="font-tabular px-4 py-3">{plan.avg_duration_months} meses</td>
                <td className="font-display font-tabular px-4 py-3 font-medium text-amber-700">
                  {formatCurrencyBRL(calculatePlanLtv(plan))}
                </td>
                <td className="px-4 py-3">
                  {plan.active ? (
                    <span className="text-xs text-status-paid">Ativo</span>
                  ) : (
                    <span className="text-xs text-ink-500">Inativo</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <PlanForm
                    plan={plan}
                    trigger={
                      <span className="rounded-md bg-white/[0.06] px-3 py-1 text-xs font-semibold text-ink-100 hover:bg-white/[0.1]">
                        Editar
                      </span>
                    }
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
