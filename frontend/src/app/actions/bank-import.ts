"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAnthropicClient, isAnthropicConfigured } from "@/lib/anthropic";
import type { ParsedStatementRow } from "@/lib/bank-statement-parser";

export type ImportBankStatementResult =
  | { success: true; imported: number; skipped: number }
  | { success: false; error: string };

export async function importBankStatement(
  accountLabel: string,
  format: "csv" | "ofx",
  filename: string,
  rows: ParsedStatementRow[]
): Promise<ImportBankStatementResult> {
  if (rows.length === 0) {
    return { success: false, error: "Nenhuma transação encontrada no arquivo." };
  }

  const supabase = await createClient();

  const { data: importRow, error: importError } = await supabase
    .from("bank_statement_imports")
    .insert({ account_label: accountLabel, format, filename })
    .select("id")
    .single();

  if (importError || !importRow) {
    return { success: false, error: "Erro ao registrar a importação." };
  }

  const stagingRows = rows.map((r) => ({
    import_id: importRow.id,
    date: r.date,
    description: r.description,
    amount: r.amount,
    pluggy_type: r.type,
    import_dedupe_key: `${accountLabel}|${r.date}|${r.description}|${r.amount}|${r.type}`,
  }));

  const { error: insertError, count } = await supabase
    .from("bank_transactions_staging")
    .upsert(stagingRows, { onConflict: "import_dedupe_key", ignoreDuplicates: true, count: "exact" });

  if (insertError) {
    return { success: false, error: `Erro ao salvar transações: ${insertError.message}` };
  }

  revalidatePath("/banco/conciliacao");
  revalidatePath("/banco/extrato");
  return { success: true, imported: count ?? rows.length, skipped: rows.length - (count ?? rows.length) };
}

export type CategorySuggestion = { description: string; suggestedCategory: string | null };

/**
 * Sugere a categoria mais provável para cada linha do extrato, com base na
 * descrição — nunca aplica automaticamente, só preenche um valor editável
 * no preview antes da confirmação.
 */
export async function suggestCategoriesForImport(
  descriptions: string[],
  availableCategories: string[]
): Promise<CategorySuggestion[]> {
  if (!isAnthropicConfigured() || descriptions.length === 0) {
    return descriptions.map((description) => ({ description, suggestedCategory: null }));
  }

  try {
    const client = createAnthropicClient();
    const response = await client.messages.create({
      model: "claude-sonnet-5",
      max_tokens: 2048,
      system: `Você categoriza lançamentos de extrato bancário de uma escola de mentoria de inglês. Categorias disponíveis: ${availableCategories.join(", ")}. Para cada descrição numerada, responda APENAS com o número seguido de ":" e o nome exato de uma categoria da lista (ou "Nenhuma" se não tiver certeza). Uma linha por item, sem texto extra.`,
      messages: [
        {
          role: "user",
          content: descriptions.map((d, i) => `${i + 1}: ${d}`).join("\n"),
        },
      ],
    });

    const text = response.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n");

    const suggestions = new Map<number, string>();
    for (const line of text.split("\n")) {
      const match = line.match(/^(\d+):\s*(.+)$/);
      if (match) {
        const category = match[2].trim();
        if (category !== "Nenhuma" && availableCategories.includes(category)) {
          suggestions.set(Number(match[1]), category);
        }
      }
    }

    return descriptions.map((description, i) => ({
      description,
      suggestedCategory: suggestions.get(i + 1) ?? null,
    }));
  } catch {
    return descriptions.map((description) => ({ description, suggestedCategory: null }));
  }
}
