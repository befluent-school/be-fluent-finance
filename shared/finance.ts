import type { Plan, Teacher } from "./types";

/** LTV = mensalidade × duração média em meses. */
export function calculatePlanLtv(plan: Pick<Plan, "monthly_value" | "avg_duration_months">) {
  return plan.monthly_value * plan.avg_duration_months;
}

/**
 * Estima o custo mensal do professor para um plano, quando o professor tem
 * uma taxa de referência simples (R$/hora). Retorna null quando a regra de
 * pagamento é um texto livre não numérico (ex: comissão %, repasse integral)
 * — nesses casos o cálculo de margem não pode ser automatizado com segurança.
 */
export function estimateMonthlyTeacherCost(
  plan: Pick<Plan, "lessons_per_week">,
  teacher: Pick<Teacher, "payment_reference_value"> | null
) {
  if (!teacher?.payment_reference_value) return null;
  const hoursPerMonth = plan.lessons_per_week * 4;
  return teacher.payment_reference_value * hoursPerMonth;
}

export function formatCurrencyBRL(value: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}
