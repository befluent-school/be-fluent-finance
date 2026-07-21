"use server";

import { revalidatePath } from "next/cache";
import * as z from "zod";
import { createClient } from "@/lib/supabase/server";

/**
 * Gera as faturas do mês de referência informado para todas as matrículas
 * ativas que ainda não têm fatura naquele mês. Idempotente: pode ser chamada
 * várias vezes no mesmo mês sem duplicar (unique constraint enrollment_id +
 * reference_month cobre isso).
 */
export async function generateMonthlyInvoices(referenceMonth: string) {
  const supabase = await createClient();

  const { data: enrollments } = await supabase
    .from("enrollments")
    .select("id, monthly_value, due_day")
    .eq("status", "active");

  if (!enrollments || enrollments.length === 0) {
    return { created: 0 };
  }

  const [year, month] = referenceMonth.split("-").map(Number);

  const rows = enrollments.map((enrollment) => {
    const dueDate = new Date(Date.UTC(year, month - 1, enrollment.due_day));
    return {
      enrollment_id: enrollment.id,
      reference_month: `${referenceMonth}-01`,
      amount: enrollment.monthly_value,
      due_date: dueDate.toISOString().slice(0, 10),
    };
  });

  const { data, error } = await supabase
    .from("invoices")
    .upsert(rows, { onConflict: "enrollment_id,reference_month", ignoreDuplicates: true })
    .select("id");

  if (error) {
    return { created: 0, error: error.message };
  }

  revalidatePath("/mensalidades");
  return { created: data?.length ?? 0 };
}

const MarkPaidSchema = z.object({
  invoiceId: z.uuid(),
  paidDate: z.string().min(1),
  paymentMethod: z.enum(["pix", "cartao", "boleto", "transferencia"]),
  lateFeeAmount: z.coerce.number().min(0).default(0),
  interestAmount: z.coerce.number().min(0).default(0),
});

export type MarkPaidState = { error?: string } | undefined;

export async function markInvoicePaid(
  _state: MarkPaidState,
  formData: FormData
): Promise<MarkPaidState> {
  const validated = MarkPaidSchema.safeParse({
    invoiceId: formData.get("invoiceId"),
    paidDate: formData.get("paidDate"),
    paymentMethod: formData.get("paymentMethod"),
    lateFeeAmount: formData.get("lateFeeAmount"),
    interestAmount: formData.get("interestAmount"),
  });

  if (!validated.success) {
    return { error: "Dados inválidos." };
  }

  const { lateFeeAmount, interestAmount } = validated.data;

  const supabase = await createClient();
  const { data: invoice, error } = await supabase
    .from("invoices")
    .update({
      paid_date: validated.data.paidDate,
      payment_method: validated.data.paymentMethod,
      late_fee_amount: lateFeeAmount,
      interest_amount: interestAmount,
    })
    .eq("id", validated.data.invoiceId)
    .select("id, amount, enrollment_id, enrollments(students(full_name))")
    .single();

  if (error || !invoice) {
    return { error: "Erro ao registrar pagamento." };
  }

  const total = invoice.amount + lateFeeAmount + interestAmount;

  await supabase.from("invoices").update({ total_paid: total }).eq("id", invoice.id);

  // Toda mensalidade paga vira automaticamente uma entrada no fluxo de
  // caixa — elimina a duplicação/dessincronia que a planilha tinha entre
  // "CONTROLE DE MENSALIDADES" e "FLUXO DE CAIXA".
  const studentName =
    (invoice.enrollments as unknown as { students: { full_name: string } | null })?.students
      ?.full_name ?? "aluno";

  const description =
    lateFeeAmount > 0 || interestAmount > 0
      ? `Mensalidade - ${studentName} (+ multa/juros)`
      : `Mensalidade - ${studentName}`;

  await supabase.from("cash_transactions").insert({
    date: validated.data.paidDate,
    description,
    amount: total,
    type: "entrada",
    payment_method: validated.data.paymentMethod,
    invoice_id: invoice.id,
    source: "manual",
  });

  revalidatePath("/mensalidades");
  revalidatePath("/alunos");
  revalidatePath("/fluxo-de-caixa");
  return undefined;
}
