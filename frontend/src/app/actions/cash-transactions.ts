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

const CostCategorySchema = z.object({
  name: z.string().min(2, { error: "Informe o nome da categoria." }),
  type: z.enum(["fixed", "variable"]),
});

export type CreateCostCategoryResult =
  | { success: true; category: { id: string; name: string; type: string } }
  | { success: false; error: string };

export async function createCostCategory(formData: FormData): Promise<CreateCostCategoryResult> {
  const validated = CostCategorySchema.safeParse({
    name: formData.get("name"),
    type: formData.get("type"),
  });

  if (!validated.success) {
    return { success: false, error: "Informe o nome e o tipo da categoria." };
  }

  const supabase = await createClient();
  const { data: category, error } = await supabase
    .from("cost_categories")
    .insert({ name: validated.data.name, type: validated.data.type })
    .select("id, name, type")
    .single();

  if (error || !category) {
    return { success: false, error: "Erro ao criar categoria. Verifique se o nome já existe." };
  }

  revalidatePath("/fluxo-de-caixa");
  return { success: true, category };
}
