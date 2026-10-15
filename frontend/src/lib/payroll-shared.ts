/**
 * Lógica e tipos PUROS da folha de professores (sem acesso a banco), para
 * poder ser importada tanto por Server Components/Actions quanto por Client
 * Components. As consultas ao banco ficam em `@/lib/queries/payroll`.
 */

export type PaymentType = "por_hora" | "comissao" | "repasse_integral" | "fixo" | "outro";

export type PayrollRow = {
  teacher_id: string;
  full_name: string;
  payment_type: PaymentType;
  payment_reference_value: number | null;
  payment_rule_text: string | null;
  payment_id: string | null;
  lessons_given: number;
  suggested_amount: number;
  final_amount: number;
  status: "aberto" | "confirmado" | "sem_folha";
  payable_id: string | null;
  notes: string | null;
};

/**
 * Valor sugerido pela regra do professor.
 * - por_hora → aulas dadas × valor/hora
 * - fixo     → valor fixo (independe das aulas)
 * - comissao / repasse_integral / outro → 0 (depende da receita dos alunos, que
 *   varia; o owner preenche o valor final manualmente, usando a regra como guia).
 */
export function suggestAmount(
  paymentType: PaymentType,
  referenceValue: number | null,
  lessonsGiven: number,
): number {
  const ref = referenceValue ?? 0;
  if (paymentType === "por_hora") return Math.round(ref * lessonsGiven * 100) / 100;
  if (paymentType === "fixo") return ref;
  return 0;
}
