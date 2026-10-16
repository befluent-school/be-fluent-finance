import { todayBR } from "@/lib/dates";
import { asc, eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth/session";
import { withUser, sequential } from "@/lib/db";
import { plans as plansTable, studentTargets } from "@/lib/db/schema";
import { getMonthTargets } from "@/lib/queries/kpis";
import {
  upsertRevenueTarget,
  upsertStudentTarget,
  upsertCacTarget,
  upsertLtvCacTarget,
} from "@/app/actions/targets";
import { TargetForm } from "./target-form";

export default async function MetasPage() {
  const user = await requireUser();
  const referenceMonth = todayBR().slice(0, 7) + "-01";

  const { plans, targets, studentTargetRows } = await withUser(user.id, async (tx) => {
    const [plans, targets, studentTargetRows] = await sequential([
      () => tx
        .select({ id: plansTable.id, name: plansTable.name })
        .from(plansTable)
        .where(eq(plansTable.active, true))
        .orderBy(asc(plansTable.name)),
      () => getMonthTargets(tx, referenceMonth),
      () => tx
        .select({ plan_id: studentTargets.planId, target_count: studentTargets.targetCount })
        .from(studentTargets)
        .where(eq(studentTargets.referenceMonth, referenceMonth)),
    ]);
    return { plans, targets, studentTargetRows };
  });
  const revenueTarget = targets.revenueTarget != null ? { target_amount: targets.revenueTarget } : null;
  const cacTarget = targets.maxCac != null ? { max_cac: targets.maxCac } : null;
  const ltvCacTarget = targets.minLtvCacRatio != null ? { min_ratio: targets.minLtvCacRatio } : null;

  const studentTargetByPlan = new Map(
    studentTargetRows.map((t) => [t.plan_id, t.target_count])
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
