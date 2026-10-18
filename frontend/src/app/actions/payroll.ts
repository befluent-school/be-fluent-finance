"use server";

import { revalidatePath } from "next/cache";
import * as z from "zod";
import { and, eq, sql } from "drizzle-orm";
import { withUser } from "@/lib/db";
import { teacherPayments, payables, costCategories } from "@/lib/db/schema";
import { logDbError } from "@/lib/db/errors";
import { FORBIDDEN_MESSAGE, getActionUser } from "@/lib/auth/session";
import { Policies } from "@/lib/auth/policies";
import { referenceMonthDate } from "@/lib/validation";
import { suggestAmount, type PaymentType } from "@/lib/queries/payroll";

export type PayrollActionState =
  | { errors?: Record<string, string[]>; message?: string; success?: boolean }
  | undefined;

const SaveSchema = z.object({
  teacherId: z.uuid(),
  referenceMonth: referenceMonthDate,
  lessonsGiven: z.coerce.number().int().min(0).max(1000),
  finalAmount: z.coerce.number().min(0).max(99_999_999.99),
  notes: z.string().max(2000).nullable().optional(),
});

/**
 * Salva (upsert) a folha de UM professor no mês. Recalcula o valor sugerido
 * pela regra a partir das aulas dadas; o valor final é o informado pelo owner
 * (pode diferir por faltas/remarcações). Mantém status "aberto" até confirmar.
 */
export async function saveTeacherPayment(
  _state: PayrollActionState,
  formData: FormData,
): Promise<PayrollActionState> {
  const user = await getActionUser(Policies.ownerOrSocio);
  if (!user) return { message: FORBIDDEN_MESSAGE };

  const validated = SaveSchema.safeParse({
    teacherId: formData.get("teacherId"),
    referenceMonth: formData.get("referenceMonth"),
    lessonsGiven: formData.get("lessonsGiven"),
    finalAmount: formData.get("finalAmount"),
    notes: formData.get("notes"),
  });
  if (!validated.success) return { errors: validated.error.flatten().fieldErrors };

  const { teacherId, referenceMonth, lessonsGiven, finalAmount, notes } = validated.data;

  try {
    await withUser(user.id, async (tx) => {
      // Regra do professor para recalcular o sugerido.
      const { rows } = await tx.execute(
        sql`select t.payment_type, t.payment_reference_value,
                   coalesce((
                     select sum(coalesce(i.total_paid, i.amount))
                       from public.invoices i
                       join public.enrollments e on e.id = i.enrollment_id
                      where e.teacher_id = t.id
                        and i.reference_month = ${referenceMonth}::date
                        and i.paid_date is not null
                   ), 0) as student_revenue
            from public.teachers t where t.id = ${teacherId}::uuid`,
      );
      const t = rows[0];
      if (!t) throw new Error("teacher_not_found");
      const suggested = suggestAmount(
        t.payment_type as PaymentType,
        t.payment_reference_value === null ? null : Number(t.payment_reference_value),
        lessonsGiven,
        Number(t.student_revenue ?? 0),
      );

      await tx
        .insert(teacherPayments)
        .values({
          teacherId,
          referenceMonth,
          lessonsGiven,
          suggestedAmount: suggested,
          finalAmount,
          notes: notes || null,
          status: "aberto",
        })
        .onConflictDoUpdate({
          target: [teacherPayments.teacherId, teacherPayments.referenceMonth],
          // Não sobrescreve folhas já confirmadas (que viraram conta a pagar).
          set: {
            lessonsGiven,
            suggestedAmount: suggested,
            finalAmount,
            notes: notes || null,
            updatedAt: sql`now()`,
          },
          setWhere: sql`${teacherPayments.status} <> 'confirmado'`,
        });
    });
  } catch (err) {
    logDbError("saveTeacherPayment", err);
    return { message: "Erro ao salvar a folha do professor." };
  }

  revalidatePath("/professores");
  return { success: true };
}

const ConfirmSchema = z.object({
  paymentId: z.uuid(),
});

/**
 * Confirma a folha e gera a conta a pagar correspondente (categoria
 * "Pagamento Professores"). Idempotente: se já houver payable vinculado, só
 * garante o status. Vencimento no dia 10 do mês seguinte à competência.
 */
export async function confirmTeacherPayment(
  _state: PayrollActionState,
  formData: FormData,
): Promise<PayrollActionState> {
  const user = await getActionUser(Policies.ownerOrSocio);
  if (!user) return { message: FORBIDDEN_MESSAGE };

  const validated = ConfirmSchema.safeParse({ paymentId: formData.get("paymentId") });
  if (!validated.success) return { message: "Folha inválida." };
  const { paymentId } = validated.data;

  try {
    await withUser(user.id, async (tx) => {
      const [tp] = await tx
        .select({
          id: teacherPayments.id,
          teacherId: teacherPayments.teacherId,
          referenceMonth: teacherPayments.referenceMonth,
          finalAmount: teacherPayments.finalAmount,
          status: teacherPayments.status,
          payableId: teacherPayments.payableId,
        })
        .from(teacherPayments)
        .where(eq(teacherPayments.id, paymentId));
      if (!tp) throw new Error("payment_not_found");
      if (tp.status === "confirmado" && tp.payableId) return; // idempotente

      // Nome do professor + categoria.
      const { rows: tn } = await tx.execute(
        sql`select full_name from public.teachers where id = ${tp.teacherId}::uuid`,
      );
      const teacherName = (tn[0]?.full_name as string) ?? "Professor";

      const [cat] = await tx
        .select({ id: costCategories.id })
        .from(costCategories)
        .where(eq(costCategories.name, "Pagamento Professores"));

      // Vencimento: dia 10 do mês seguinte à competência.
      const [y, m] = tp.referenceMonth.split("-").map(Number);
      const due = new Date(Date.UTC(y, m, 10)).toISOString().slice(0, 10);
      const mesLabel = new Date(`${tp.referenceMonth}T00:00:00Z`).toLocaleDateString("pt-BR", {
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      });

      const [payable] = await tx
        .insert(payables)
        .values({
          description: `Pagamento professor — ${teacherName} — ${mesLabel}`,
          categoryId: cat?.id ?? null,
          referenceMonth: tp.referenceMonth,
          amount: tp.finalAmount,
          dueDate: due,
          status: "pendente",
          origin: "teacher",
        })
        .returning({ id: payables.id });

      await tx
        .update(teacherPayments)
        .set({ status: "confirmado", payableId: payable.id, updatedAt: sql`now()` })
        .where(eq(teacherPayments.id, paymentId));
    });
  } catch (err) {
    logDbError("confirmTeacherPayment", err);
    return { message: "Erro ao confirmar a folha e gerar a conta a pagar." };
  }

  revalidatePath("/professores");
  revalidatePath("/contas");
  return { success: true };
}

/**
 * Reabre uma folha confirmada: remove a conta a pagar gerada (se ainda não
 * paga) e volta o status para "aberto", permitindo correção.
 */
export async function reopenTeacherPayment(
  _state: PayrollActionState,
  formData: FormData,
): Promise<PayrollActionState> {
  const user = await getActionUser(Policies.ownerOrSocio);
  if (!user) return { message: FORBIDDEN_MESSAGE };

  const validated = ConfirmSchema.safeParse({ paymentId: formData.get("paymentId") });
  if (!validated.success) return { message: "Folha inválida." };
  const { paymentId } = validated.data;

  try {
    await withUser(user.id, async (tx) => {
      const [tp] = await tx
        .select({ payableId: teacherPayments.payableId })
        .from(teacherPayments)
        .where(eq(teacherPayments.id, paymentId));
      if (!tp) throw new Error("payment_not_found");

      if (tp.payableId) {
        // Só remove a conta a pagar se ainda estiver pendente (não quitada).
        await tx
          .delete(payables)
          .where(and(eq(payables.id, tp.payableId), eq(payables.status, "pendente")));
      }
      await tx
        .update(teacherPayments)
        .set({ status: "aberto", payableId: null, updatedAt: sql`now()` })
        .where(eq(teacherPayments.id, paymentId));
    });
  } catch (err) {
    logDbError("reopenTeacherPayment", err);
    return { message: "Erro ao reabrir a folha." };
  }

  revalidatePath("/professores");
  revalidatePath("/contas");
  return { success: true };
}
