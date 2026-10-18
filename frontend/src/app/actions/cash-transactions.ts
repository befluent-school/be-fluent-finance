"use server";

import { revalidatePath } from "next/cache";
import * as z from "zod";
import { eq, sql } from "drizzle-orm";
import { withUser } from "@/lib/db";
import { cashTransactions, categorizationRules, costCategories } from "@/lib/db/schema";
import { logDbError } from "@/lib/db/errors";
import { FORBIDDEN_MESSAGE, getActionUser } from "@/lib/auth/session";
import { Policies } from "@/lib/auth/policies";
import { isoDate } from "@/lib/validation";

const CashTransactionSchema = z.object({
  date: isoDate,
  description: z.string().trim().min(2, { error: "Informe uma descrição." }).max(500),
  categoryId: z.union([z.uuid(), z.literal("")]).nullable().optional(),
  amount: z.coerce
    .number()
    .positive({ error: "Valor deve ser maior que zero." })
    .max(99_999_999.99, { error: "Valor alto demais." }),
  type: z.enum(["entrada", "saida"]),
  paymentMethod: z
    .union([z.enum(["pix", "cartao", "boleto", "transferencia"]), z.literal("")])
    .nullable()
    .optional(),
  notes: z.string().max(2000).nullable().optional(),
});

export type CashTransactionState =
  | { errors?: Record<string, string[]>; message?: string; success?: boolean; ruleApplied?: number }
  | undefined;

function readTransaction(formData: FormData) {
  return {
    date: formData.get("date"),
    description: formData.get("description"),
    categoryId: formData.get("categoryId"),
    amount: formData.get("amount"),
    type: formData.get("type"),
    paymentMethod: formData.get("paymentMethod"),
    notes: formData.get("notes"),
  };
}

export async function createCashTransaction(
  _state: CashTransactionState,
  formData: FormData
): Promise<CashTransactionState> {
  const user = await getActionUser(Policies.manageInvoices);
  if (!user) return { message: FORBIDDEN_MESSAGE };

  const validated = CashTransactionSchema.safeParse(readTransaction(formData));
  if (!validated.success) {
    return { errors: validated.error.flatten().fieldErrors };
  }

  const { date, description, categoryId, amount, type, paymentMethod, notes } = validated.data;

  try {
    await withUser(user.id, (tx) =>
      tx.insert(cashTransactions).values({
        date,
        description,
        categoryId: categoryId || null,
        amount,
        type,
        paymentMethod: paymentMethod || null,
        notes: notes || null,
        source: "manual",
      })
    );
  } catch (err) {
    logDbError("createCashTransaction", err);
    return { message: "Erro ao lançar a movimentação. Tente novamente." };
  }

  revalidatePath("/fluxo-de-caixa");
  return { success: true };
}

const UpdateCashTransactionSchema = CashTransactionSchema.extend({
  id: z.uuid(),
});

export async function updateCashTransaction(
  _state: CashTransactionState,
  formData: FormData
): Promise<CashTransactionState> {
  const user = await getActionUser(Policies.manageInvoices);
  if (!user) return { message: FORBIDDEN_MESSAGE };

  const validated = UpdateCashTransactionSchema.safeParse({ id: formData.get("id"), ...readTransaction(formData) });
  if (!validated.success) {
    return { errors: validated.error.flatten().fieldErrors };
  }

  const { id, date, description, categoryId, amount, type, paymentMethod, notes } = validated.data;
  // "Sempre categorizar assim": vira regra aplicada aos parecidos agora e nos próximos syncs.
  const rulePattern = String(formData.get("rulePattern") ?? "").trim().slice(0, 120);
  const learnRule = formData.get("learnRule") === "on" && Boolean(categoryId) && rulePattern.length >= 3;
  let ruleApplied = 0;

  try {
    const updated = await withUser(user.id, async (tx) => {
      const rows = await tx
        .update(cashTransactions)
        .set({
          date,
          description,
          categoryId: categoryId || null,
          amount,
          type,
          paymentMethod: paymentMethod || null,
          notes: notes || null,
        })
        .where(eq(cashTransactions.id, id))
        .returning({ id: cashTransactions.id });
      if (rows.length > 0 && learnRule && categoryId) {
        await tx
          .insert(categorizationRules)
          .values({ pattern: rulePattern, type, categoryId, createdBy: user.id })
          .onConflictDoUpdate({
            target: [categorizationRules.pattern, categorizationRules.type],
            set: { categoryId },
          });
        const { rows: applied } = await tx.execute<{ n: number }>(
          sql`select public.categorizar_lancamentos_bancarios() as n`
        );
        ruleApplied = Number(applied[0]?.n ?? 0);
      }
      return rows;
    });
    if (updated.length === 0) return { message: "Lançamento não encontrado." };
  } catch (err) {
    logDbError("updateCashTransaction", err);
    return { message: "Erro ao atualizar o lançamento. Tente novamente." };
  }

  revalidatePath("/fluxo-de-caixa");
  revalidatePath("/dashboard");
  return { success: true, ruleApplied };
}

const CostCategorySchema = z.object({
  name: z.string().trim().min(2, { error: "Informe o nome da categoria." }).max(100),
  type: z.enum(["fixed", "variable"]),
});

export type CreateCostCategoryResult =
  | { success: true; category: { id: string; name: string; type: string } }
  | { success: false; error: string };

export async function createCostCategory(formData: FormData): Promise<CreateCostCategoryResult> {
  // Categorias são configuração (RLS: owner/sócio), não lançamento do dia a dia.
  const user = await getActionUser(Policies.ownerOrSocio);
  if (!user) return { success: false, error: FORBIDDEN_MESSAGE };

  const validated = CostCategorySchema.safeParse({
    name: formData.get("name"),
    type: formData.get("type"),
  });

  if (!validated.success) {
    return { success: false, error: "Informe o nome e o tipo da categoria." };
  }

  try {
    const [category] = await withUser(user.id, (tx) =>
      tx
        .insert(costCategories)
        .values({ name: validated.data.name, type: validated.data.type })
        .returning({ id: costCategories.id, name: costCategories.name, type: costCategories.type })
    );
    revalidatePath("/fluxo-de-caixa");
    return { success: true, category };
  } catch (err) {
    logDbError("createCostCategory", err);
    return { success: false, error: "Erro ao criar categoria. Verifique se o nome já existe." };
  }
}
