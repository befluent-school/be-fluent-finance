import { createClient } from "@/lib/supabase/server";
import type { Plan } from "@shared/types";
import {
  upsertRevenueTarget,
  upsertStudentTarget,
  upsertCacTarget,
  upsertLtvCacTarget,
} from "@/app/actions/targets";
import { TargetForm } from "./target-form";

export default async function MetasPage() {
  const supabase = await createClient();
  const referenceMonth = new Date().toISOString().slice(0, 7) + "-01";

  const [{ data: plans }, { data: revenueTarget }, { data: studentTargets }, { data: cacTarget }, { data: ltvCacTarget }] =
    await Promise.all([
      supabase.from("plans").select("*").eq("active", true).order("name").returns<Plan[]>(),
      supabase
        .from("revenue_targets")
        .select("target_amount")
        .eq("reference_month", referenceMonth)
        .maybeSingle(),
      supabase
        .from("student_targets")
        .select("plan_id, target_count")
        .eq("reference_month", referenceMonth),
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
    ]);

  const studentTargetByPlan = new Map(
    (studentTargets ?? []).map((t) => [t.plan_id, t.target_count])
  );

  const monthLabel = new Date(referenceMonth + "T00:00:00").toLocaleDateString("pt-BR", {
    month: "long",
    year: "numeric",
  });

  return (
    <div>
      <p className="text-sm text-ink-300">
        Metas de referência para <span className="text-ink-100">{monthLabel}</span>. Alimentam o
        Dashboard automaticamente.
      </p>

      <h2 className="mt-8 text-lg font-semibold text-ink-50">Faturamento</h2>
      <div className="mt-3 card-premium rounded-lg p-6">
        <TargetForm
          action={upsertRevenueTarget}
          referenceMonth={referenceMonth}
          fieldName="targetAmount"
          fieldLabel="Meta de faturamento mensal (R$)"
          defaultValue={revenueTarget?.target_amount}
        />
      </div>

      <h2 className="mt-8 text-lg font-semibold text-ink-50">Alunos por plano</h2>
      <div className="mt-3 space-y-3">
        {(plans ?? []).map((plan) => (
          <div key={plan.id} className="card-premium rounded-lg p-6">
            <TargetForm
              action={upsertStudentTarget}
              referenceMonth={referenceMonth}
              fieldName="targetCount"
              fieldLabel={`Meta de alunos — ${plan.name}`}
              defaultValue={studentTargetByPlan.get(plan.id)}
              step="1"
              hiddenFields={{ planId: plan.id }}
            />
          </div>
        ))}
        {(plans ?? []).length === 0 && (
          <p className="text-sm text-ink-500">Nenhum plano ativo cadastrado.</p>
        )}
      </div>

      <h2 className="mt-8 text-lg font-semibold text-ink-50">Aquisição (CAC e LTV:CAC)</h2>
      <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="card-premium rounded-lg p-6">
          <TargetForm
            action={upsertCacTarget}
            referenceMonth={referenceMonth}
            fieldName="maxCac"
            fieldLabel="CAC máximo aceitável (R$)"
            defaultValue={cacTarget?.max_cac}
          />
        </div>
        <div className="card-premium rounded-lg p-6">
          <TargetForm
            action={upsertLtvCacTarget}
            referenceMonth={referenceMonth}
            fieldName="minRatio"
            fieldLabel="Razão LTV:CAC mínima desejada"
            defaultValue={ltvCacTarget?.min_ratio}
            step="0.1"
          />
        </div>
      </div>
    </div>
  );
}
