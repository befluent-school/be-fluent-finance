"use server";

import { revalidatePath } from "next/cache";
import * as z from "zod";
import { eq } from "drizzle-orm";
import { withUser } from "@/lib/db";
import { payables } from "@/lib/db/schema";
import { logDbError } from "@/lib/db/errors";
import { FORBIDDEN_MESSAGE, getActionUser } from "@/lib/auth/session";
import { Policies } from "@/lib/auth/policies";
import { isoDate, referenceMonthDate } from "@/lib/validation";

const PayableSchema = z.object({
  description: z.string().trim().min(2, { error: "Informe a descrição." }).max(500),
  categoryId: z.union([z.uuid(), z.literal("")]).nullable().optional(),
  referenceMonth: referenceMonthDate,
  amount: z.coerce.number().positive({ error: "Valor deve ser maior que zero." }).max(99_999_999.99),
  dueDate: isoDate,
  notes: z.string().max(2000).nullable().optional(),
});

export type PayableState =
  | { errors?: Record<string, string[]>; message?: string; success?: boolean }
  | undefined;

function readPayable(formData: FormData) {
  return {
    description: formData.get("description"),
    categoryId: formData.get("categoryId"),
    referenceMonth: formData.get("referenceMonth"),
    amount: formData.get("amount"),
    dueDate: formData.get("dueDate"),
    notes: formData.get("notes"),
  };
}

export async function createPayable(_state: PayableState, formData: FormData): Promise<PayableState> {
  const user = await getActionUser(Policies.manageFinance);
  if (!user) return { message: FORBIDDEN_MESSAGE };

  const validated = PayableSchema.safeParse(readPayable(formData));
  if (!validated.success) return { errors: validated.error.flatten().fieldErrors };

  const { description, categoryId, referenceMonth, amount, dueDate, notes } = validated.data;

  try {
    await withUser(user.id, (tx) =>
      tx.insert(payables).values({
        description,
        categoryId: categoryId || null,
        referenceMonth,
        amount,
        dueDate,
        notes: notes || null,
        origin: "manual",
      })
    );
  } catch (err) {
    logDbError("createPayable", err);
    return { message: "Erro ao lançar a conta a pagar." };
  }

  revalidatePath("/contas");
  revalidatePath("/dashboard");
  return { success: true };
}

const MarkPayableSchema = z.object({
  payableId: z.uuid(),
  paidDate: isoDate,
  paymentMethod: z.enum(["pix", "cartao", "boleto", "transferencia"]),
  totalPaid: z.coerce.number().min(0).max(99_999_999.99).optional(),
});

export type MarkPayablePaidState = { error?: string } | undefined;

export async function markPayablePaid(
  _state: MarkPayablePaidState,
  formData: FormData
): Promise<MarkPayablePaidState> {
  const user = await getActionUser(Policies.manageFinance);
  if (!user) return { error: FORBIDDEN_MESSAGE };

  const validated = MarkPayableSchema.safeParse({
    payableId: formData.get("payableId"),
    paidDate: formData.get("paidDate"),
    paymentMethod: formData.get("paymentMethod"),
    totalPaid: formData.get("totalPaid") || undefined,
  });
  if (!validated.success) return { error: "Dados inválidos." };

  const { payableId, paidDate, paymentMethod, totalPaid } = validated.data;

  try {
    const updated = await withUser(user.id, async (tx) => {
      const [row] = await tx.select({ amount: payables.amount }).from(payables).where(eq(payables.id, payableId));
      if (!row) return 0;
      const total = totalPaid ?? row.amount;
      const res = await tx
        .update(payables)
        .set({ paidDate, paymentMethod, totalPaid: total })
        .where(eq(payables.id, payableId))
        .returning({ id: payables.id });
      return res.length;
    });
    if (updated === 0) return { error: "Conta não encontrada." };
  } catch (err) {
    logDbError("markPayablePaid", err);
    return { error: "Erro ao registrar o pagamento." };
  }

  revalidatePath("/contas");
  revalidatePath("/impostos");
  revalidatePath("/dashboard");
  return undefined;
}

export async function deletePayable(payableId: string) {
  const user = await getActionUser(Policies.manageFinance);
  if (!user) return { error: FORBIDDEN_MESSAGE };
  if (!z.uuid().safeParse(payableId).success) return { error: "Conta inválida." };

  try {
    const deleted = await withUser(user.id, (tx) =>
      tx.delete(payables).where(eq(payables.id, payableId)).returning({ id: payables.id })
    );
    if (deleted.length === 0) return { error: "Conta não encontrada." };
  } catch (err) {
    logDbError("deletePayable", err);
    return { error: "Erro ao excluir a conta." };
  }

  revalidatePath("/contas");
  revalidatePath("/dashboard");
  return { success: true };
}
