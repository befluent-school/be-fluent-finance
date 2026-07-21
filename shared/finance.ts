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

/**
 * Multa fixa de 10% + juros de 1% ao mês (pro-rata pelos dias de atraso)
 * sobre mensalidades pagas após o vencimento — regra padrão da Be Fluent.
 * Sem atraso (paidDate <= dueDate), retorna tudo zerado.
 */
export function calculateLateFee(amount: number, dueDate: string, paidDate: string) {
  const due = new Date(dueDate + "T00:00:00");
  const paid = new Date(paidDate + "T00:00:00");
  const daysLate = Math.floor((paid.getTime() - due.getTime()) / (1000 * 60 * 60 * 24));

  if (daysLate <= 0) {
    return { lateFee: 0, interest: 0, total: amount };
  }

  const lateFee = amount * 0.1;
  const interest = amount * 0.01 * (daysLate / 30);
  return {
    lateFee: Math.round(lateFee * 100) / 100,
    interest: Math.round(interest * 100) / 100,
    total: Math.round((amount + lateFee + interest) * 100) / 100,
  };
}
