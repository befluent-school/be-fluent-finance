"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAnthropicClient, isAnthropicConfigured } from "@/lib/anthropic";

export type CategorySuggestion = { description: string; suggestedCategory: string | null };

/**
 * Sugere a categoria mais provável para cada linha do extrato, com base na
 * descrição — só preenche um valor sugerido e editável no preview, nunca é
 * aplicado sem o usuário revisar e confirmar o lote.
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

export type ConfirmBankImportRow = {
  date: string;
  description: string;
  amount: number;
  type: "CREDIT" | "DEBIT";
  categoryId: string | null;
};

export type ConfirmBankImportResult =
  | { success: true; imported: number }
  | { success: false; error: string };

/**
 * Lança direto no fluxo de caixa as transações já revisadas pelo usuário no
 * preview — sem etapa intermediária de "pendente" aguardando aprovação
 * individual (fluxo anterior era lento demais para extratos com dezenas de
 * linhas). A revisão acontece toda no client antes desta chamada.
 */
export async function confirmBankImport(
  accountLabel: string,
  rows: ConfirmBankImportRow[]
): Promise<ConfirmBankImportResult> {
  if (rows.length === 0) {
    return { success: false, error: "Nenhuma transação para importar." };
  }

  const supabase = await createClient();

  const cashRows = rows.map((r) => ({
    date: r.date,
    description: `${r.description} (${accountLabel})`,
    category_id: r.categoryId,
    amount: r.amount,
    type: r.type === "CREDIT" ? "entrada" : "saida",
    source: "manual_import",
  }));

  const { error, count } = await supabase
    .from("cash_transactions")
    .insert(cashRows, { count: "exact" });

  if (error) {
    return { success: false, error: `Erro ao lançar transações: ${error.message}` };
  }

  revalidatePath("/fluxo-de-caixa");
  revalidatePath("/dashboard");
  revalidatePath("/banco/extrato");
  return { success: true, imported: count ?? rows.length };
}
