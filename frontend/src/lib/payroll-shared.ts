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
  /** Mensalidades pagas no mês pelos alunos deste professor. */
  student_revenue: number;
  /** Alunos com matrícula ativa com este professor. */
  active_students: number;
};

/**
 * Valor sugerido pela regra do professor.
 * - por_hora → aulas dadas × valor/hora
 * - fixo     → valor fixo (independe das aulas)
 * - comissao → % (valor de referência) × mensalidades pagas pelos alunos dele no mês
 * - repasse_integral → 100% das mensalidades pagas pelos alunos dele no mês
 * - outro → 0 (o owner informa o valor)
 */
export function suggestAmount(
  paymentType: PaymentType,
  referenceValue: number | null,
  lessonsGiven: number,
  studentRevenue = 0,
): number {
  const ref = referenceValue ?? 0;
  const round = (v: number) => Math.round(v * 100) / 100;
  if (paymentType === "por_hora") return round(ref * lessonsGiven);
  if (paymentType === "fixo") return ref;
  if (paymentType === "comissao") return round((studentRevenue * ref) / 100);
  if (paymentType === "repasse_integral") return round(studentRevenue);
  return 0;
}
