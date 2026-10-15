import "server-only";
import { sql } from "drizzle-orm";
import type { Tx } from "@/lib/db";
import type { PaymentType, PayrollRow } from "@/lib/payroll-shared";

/**
 * Consultas de folha de pagamento de professores (acesso ao banco).
 *
 * A lógica pura (suggestAmount) e os tipos ficam em `@/lib/payroll-shared`,
 * para poderem ser usados também em Client Components. Ao confirmar, a folha
 * vira uma conta a pagar (payables) na categoria "Pagamento Professores".
 *
 * Tabelas: public.teachers (payment_type), public.teacher_payments (0030).
 */

export type { PaymentType, PayrollRow } from "@/lib/payroll-shared";
export { suggestAmount } from "@/lib/payroll-shared";

/**
 * Folha do mês para TODOS os professores ativos. Faz LEFT JOIN com
 * teacher_payments do mês de competência — professores sem folha aparecem com
 * status "sem_folha" e zeros, para o owner poder gerar/preencher.
 */
export async function listPayrollForMonth(tx: Tx, referenceMonth: string): Promise<PayrollRow[]> {
  const { rows } = await tx.execute(
    sql`select
          t.id as teacher_id,
          t.full_name,
          t.payment_type,
          t.payment_reference_value,
          t.payment_rule_text,
          tp.id as payment_id,
          coalesce(tp.lessons_given, 0) as lessons_given,
          coalesce(tp.suggested_amount, 0) as suggested_amount,
          coalesce(tp.final_amount, 0) as final_amount,
          coalesce(tp.status, 'sem_folha') as status,
          tp.payable_id,
          tp.notes
        from public.teachers t
        left join public.teacher_payments tp
          on tp.teacher_id = t.id and tp.reference_month = ${referenceMonth}::date
        where t.active = true
        order by lower(t.full_name)`,
  );
  return rows.map((r) => ({
    teacher_id: r.teacher_id as string,
    full_name: r.full_name as string,
    payment_type: r.payment_type as PaymentType,
    payment_reference_value: r.payment_reference_value === null ? null : Number(r.payment_reference_value),
    payment_rule_text: (r.payment_rule_text as string | null) ?? null,
    payment_id: (r.payment_id as string | null) ?? null,
    lessons_given: Number(r.lessons_given),
    suggested_amount: Number(r.suggested_amount),
    final_amount: Number(r.final_amount),
    status: r.status as PayrollRow["status"],
    payable_id: (r.payable_id as string | null) ?? null,
    notes: (r.notes as string | null) ?? null,
  }));
}

export type PayrollTotals = { confirmado: number; aberto: number; professores: number };

export async function getPayrollTotals(tx: Tx, referenceMonth: string): Promise<PayrollTotals> {
  const { rows } = await tx.execute(
    sql`select
          coalesce(sum(final_amount) filter (where status = 'confirmado'), 0) as confirmado,
          coalesce(sum(final_amount) filter (where status = 'aberto'), 0) as aberto,
          count(*) as professores
        from public.teacher_payments
        where reference_month = ${referenceMonth}::date`,
  );
  const r = rows[0] ?? {};
  return {
    confirmado: Number(r.confirmado ?? 0),
    aberto: Number(r.aberto ?? 0),
    professores: Number(r.professores ?? 0),
  };
}
