"use server";

import { revalidatePath } from "next/cache";
import * as z from "zod";
import { createClient } from "@/lib/supabase/server";

const CashTransactionSchema = z.object({
  date: z.string().min(1, { error: "Informe a data." }),
  description: z.string().min(2, { error: "Informe uma descrição." }),
  categoryId: z.union([z.uuid(), z.literal("")]).nullable().optional(),
  amount: z.coerce.number().positive({ error: "Valor deve ser maior que zero." }),
  type: z.enum(["entrada", "saida"]),
  paymentMethod: z
    .union([z.enum(["pix", "cartao", "boleto", "transferencia"]), z.literal("")])
    .nullable()
    .optional(),
  notes: z.string().nullable().optional(),
});

export type CashTransactionState =
  | { errors?: Record<string, string[]>; message?: string; success?: boolean }
  | undefined;

export async function createCashTransaction(
  _state: CashTransactionState,
  formData: FormData
): Promise<CashTransactionState> {
  const validated = CashTransactionSchema.safeParse({
    date: formData.get("date"),
    description: formData.get("description"),
    categoryId: formData.get("categoryId"),
    amount: formData.get("amount"),
    type: formData.get("type"),
    paymentMethod: formData.get("paymentMethod"),
    notes: formData.get("notes"),
  });

  if (!validated.success) {
    return { errors: validated.error.flatten().fieldErrors };
  }

  const { date, description, categoryId, amount, type, paymentMethod, notes } = validated.data;

  const supabase = await createClient();
  const { error } = await supabase.from("cash_transactions").insert({
    date,
    description,
    category_id: categoryId || null,
    amount,
    type,
    payment_method: paymentMethod || null,
    notes: notes || null,
    source: "manual",
  });

  if (error) {
    return { message: "Erro ao lançar a movimentação. Tente novamente." };
  }

  revalidatePath("/fluxo-de-caixa");
  return { success: true };
}
