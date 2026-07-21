"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

/**
 * Confirma uma transação em staging como um lançamento real de caixa,
 * na categoria escolhida pelo usuário. Se `createRule` for true, grava uma
 * regra para categorizar automaticamente futuras transações com a mesma
 * palavra-chave — só depois da primeira confirmação manual, nunca antes.
 */
export async function reconcileTransaction(formData: FormData) {
  const stagingId = String(formData.get("stagingId"));
  const categoryId = formData.get("categoryId") ? String(formData.get("categoryId")) : null;
  const createRule = formData.get("createRule") === "on";
  const keyword = String(formData.get("keyword") ?? "").trim();

  const supabase = await createClient();

  const { data: staging } = await supabase
    .from("bank_transactions_staging")
    .select("*")
    .eq("id", stagingId)
    .single();

  if (!staging) return;

  const { data: cashTransaction } = await supabase
    .from("cash_transactions")
    .insert({
      date: staging.date,
      description: staging.description,
      category_id: categoryId,
      amount: staging.amount,
      type: staging.pluggy_type === "CREDIT" ? "entrada" : "saida",
      source: "manual_import",
    })
    .select("id")
    .single();

  if (!cashTransaction) return;

  await supabase
    .from("bank_transactions_staging")
    .update({ reconciled_cash_transaction_id: cashTransaction.id })
    .eq("id", stagingId);

  if (createRule && keyword && categoryId) {
    await supabase.from("reconciliation_rules").insert({
      keyword_pattern: keyword.toUpperCase(),
      category_id: categoryId,
      auto_apply: true,
    });
  }

  revalidatePath("/banco/conciliacao");
  revalidatePath("/fluxo-de-caixa");
}

export async function ignoreStagingTransaction(formData: FormData) {
  const stagingId = String(formData.get("stagingId"));
  const supabase = await createClient();

  await supabase
    .from("bank_transactions_staging")
    .update({ ignored: true })
    .eq("id", stagingId);

  revalidatePath("/banco/conciliacao");
}
