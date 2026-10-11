"use server";

import { revalidatePath } from "next/cache";
import * as z from "zod";
import { eq } from "drizzle-orm";
import { withUser } from "@/lib/db";
import { recurringPayables } from "@/lib/db/schema";
import { logDbError } from "@/lib/db/errors";
import { FORBIDDEN_MESSAGE, getActionUser } from "@/lib/auth/session";
import { Policies } from "@/lib/auth/policies";
import { referenceMonthDate } from "@/lib/validation";

const RecurringSchema = z.object({
  description: z.string().trim().min(2, { error: "Informe a descrição." }).max(500),
  categoryId: z.union([z.uuid(), z.literal("")]).nullable().optional(),
  amount: z.coerce.number().positive({ error: "Valor deve ser maior que zero." }).max(99_999_999.99),
  dueDay: z.coerce.number().int().min(1, { error: "Dia entre 1 e 28." }).max(28),
  startMonth: referenceMonthDate,
  notes: z.string().max(2000).nullable().optional(),
});

export type RecurringState =
  | { errors?: Record<string, string[]>; message?: string; success?: boolean }
  | undefined;

export async function createRecurringPayable(
  _state: RecurringState,
  formData: FormData
): Promise<RecurringState> {
  const user = await getActionUser(Policies.manageFinance);
  if (!user) return { message: FORBIDDEN_MESSAGE };

  const validated = RecurringSchema.safeParse({
    description: formData.get("description"),
    categoryId: formData.get("categoryId"),
    amount: formData.get("amount"),
    dueDay: formData.get("dueDay"),
    startMonth: formData.get("startMonth"),
    notes: formData.get("notes"),
  });
  if (!validated.success) return { errors: validated.error.flatten().fieldErrors };

  const { description, categoryId, amount, dueDay, startMonth, notes } = validated.data;

  try {
    await withUser(user.id, (tx) =>
      tx.insert(recurringPayables).values({
        description,
        categoryId: categoryId || null,
        amount,
        dueDay,
        startMonth,
        notes: notes || null,
      })
    );
  } catch (err) {
    logDbError("createRecurringPayable", err);
    return { message: "Erro ao criar a conta recorrente." };
  }

  revalidatePath("/contas/recorrentes");
  revalidatePath("/contas");
  return { success: true };
}

export async function toggleRecurringPayable(id: string, active: boolean) {
  const user = await getActionUser(Policies.manageFinance);
  if (!user) return { error: FORBIDDEN_MESSAGE };
  if (!z.object({ id: z.uuid(), active: z.boolean() }).safeParse({ id, active }).success) {
    return { error: "Dados inválidos." };
  }

  try {
    await withUser(user.id, (tx) =>
      tx.update(recurringPayables).set({ active }).where(eq(recurringPayables.id, id))
    );
  } catch (err) {
    logDbError("toggleRecurringPayable", err);
    return { error: "Erro ao atualizar." };
  }

  revalidatePath("/contas/recorrentes");
  return { success: true };
}

export async function deleteRecurringPayable(id: string) {
  const user = await getActionUser(Policies.manageFinance);
  if (!user) return { error: FORBIDDEN_MESSAGE };
  if (!z.uuid().safeParse(id).success) return { error: "Registro inválido." };

  try {
    const deleted = await withUser(user.id, (tx) =>
      tx.delete(recurringPayables).where(eq(recurringPayables.id, id)).returning({ id: recurringPayables.id })
    );
    if (deleted.length === 0) return { error: "Registro não encontrado." };
  } catch (err) {
    logDbError("deleteRecurringPayable", err);
    return { error: "Erro ao excluir." };
  }

  revalidatePath("/contas/recorrentes");
  revalidatePath("/contas");
  return { success: true };
}
