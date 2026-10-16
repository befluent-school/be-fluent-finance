"use server";

import { revalidatePath } from "next/cache";
import * as z from "zod";
import { and, eq, gte, isNull, lte, or } from "drizzle-orm";
import { withUser } from "@/lib/db";
import { enrollments, invoices } from "@/lib/db/schema";
import { logDbError } from "@/lib/db/errors";
import { FORBIDDEN_MESSAGE, getActionUser } from "@/lib/auth/session";
import { Policies } from "@/lib/auth/policies";
import { isoDate, yearMonth } from "@/lib/validation";

/**
 * Gera as faturas do mês de referência informado para todas as matrículas
 * ativas que ainda não têm fatura naquele mês. Idempotente: pode ser chamada
 * várias vezes no mesmo mês sem duplicar (unique constraint enrollment_id +
 * reference_month cobre isso).
 */
export async function generateMonthlyInvoices(referenceMonth: string) {
  const user = await getActionUser(Policies.manageInvoices);
  if (!user) return { created: 0, error: FORBIDDEN_MESSAGE };
  if (!yearMonth.safeParse(referenceMonth).success) return { created: 0, error: "Mês inválido." };

  const [year, month] = referenceMonth.split("-").map(Number);
  const firstDay = `${referenceMonth}-01`;
  const lastDayNumber = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const lastDay = `${referenceMonth}-${String(lastDayNumber).padStart(2, "0")}`;

  try {
    const created = await withUser(user.id, async (tx) => {
      // Mesmas regras da virada automática (run_monthly_rollover): só matrículas
      // vigentes no mês, e vencimento limitado ao último dia do mês.
      const active = await tx
        .select({ id: enrollments.id, monthlyValue: enrollments.monthlyValue, dueDay: enrollments.dueDay })
        .from(enrollments)
        .where(
          and(
            eq(enrollments.status, "active"),
            lte(enrollments.startDate, lastDay),
            or(isNull(enrollments.endDate), gte(enrollments.endDate, firstDay))
          )
        );
      if (active.length === 0) return 0;

      const rows = active.map((enrollment) => ({
        enrollmentId: enrollment.id,
        referenceMonth: firstDay,
        amount: enrollment.monthlyValue,
        dueDate: `${referenceMonth}-${String(Math.min(enrollment.dueDay, lastDayNumber)).padStart(2, "0")}`,
      }));

      const inserted = await tx
        .insert(invoices)
        .values(rows)
        .onConflictDoNothing({ target: [invoices.enrollmentId, invoices.referenceMonth] })
        .returning({ id: invoices.id });
      return inserted.length;
    });

    revalidatePath("/mensalidades");
    return { created };
  } catch (err) {
    logDbError("generateMonthlyInvoices", err);
    return { created: 0, error: "Erro ao gerar mensalidades." };
  }
}

const MarkPaidSchema = z.object({
  invoiceId: z.uuid(),
  paidDate: isoDate,
  paymentMethod: z.enum(["pix", "cartao", "boleto", "transferencia"]),
  lateFeeAmount: z.coerce.number().min(0).max(99_999_999).default(0),
  interestAmount: z.coerce.number().min(0).max(99_999_999).default(0),
});

export type MarkPaidState = { error?: string } | undefined;

export async function markInvoicePaid(
  _state: MarkPaidState,
  formData: FormData
): Promise<MarkPaidState> {
  const user = await getActionUser(Policies.manageInvoices);
  if (!user) return { error: FORBIDDEN_MESSAGE };

  const validated = MarkPaidSchema.safeParse({
    invoiceId: formData.get("invoiceId"),
    paidDate: formData.get("paidDate"),
    paymentMethod: formData.get("paymentMethod"),
    lateFeeAmount: formData.get("lateFeeAmount") || 0,
    interestAmount: formData.get("interestAmount") || 0,
  });

  if (!validated.success) {
    return { error: "Dados inválidos." };
  }

  const { invoiceId, paidDate, paymentMethod, lateFeeAmount, interestAmount } = validated.data;

  try {
    const updated = await withUser(user.id, async (tx) => {
      const [invoice] = await tx
        .select({ amount: invoices.amount })
        .from(invoices)
        .where(eq(invoices.id, invoiceId));
      if (!invoice) return 0;

      // Uma única gravação (antes eram dois updates separados): o total pago
      // nunca fica dessincronizado da data de pagamento.
      const total = Math.round((invoice.amount + lateFeeAmount + interestAmount) * 100) / 100;
      const rows = await tx
        .update(invoices)
        .set({
          paidDate,
          paymentMethod,
          lateFeeAmount,
          interestAmount,
          totalPaid: total,
        })
        .where(eq(invoices.id, invoiceId))
        .returning({ id: invoices.id });
      return rows.length;
    });
    if (updated === 0) return { error: "Mensalidade não encontrada." };
  } catch (err) {
    logDbError("markInvoicePaid", err);
    return { error: "Erro ao registrar pagamento." };
  }

  // Mensalidades não lançam mais automaticamente no fluxo de caixa — o
  // dinheiro real só entra ali quando o extrato do banco correspondente é
  // importado. Manter os dois em sincronia manual causava duplicidade
  // quando a mesma mensalidade também aparecia no extrato importado.
  revalidatePath("/mensalidades");
  revalidatePath("/alunos");
  return undefined;
}

export async function deleteInvoice(invoiceId: string) {
  const user = await getActionUser(Policies.manageInvoices);
  if (!user) return { error: FORBIDDEN_MESSAGE };
  if (!z.uuid().safeParse(invoiceId).success) return { error: "Mensalidade inválida." };

  try {
    const deleted = await withUser(user.id, (tx) =>
      tx.delete(invoices).where(eq(invoices.id, invoiceId)).returning({ id: invoices.id })
    );
    if (deleted.length === 0) return { error: "Mensalidade não encontrada." };
  } catch (err) {
    logDbError("deleteInvoice", err);
    return { error: "Erro ao excluir mensalidade." };
  }

  revalidatePath("/mensalidades");
  revalidatePath("/alunos");
  return { success: true };
}
