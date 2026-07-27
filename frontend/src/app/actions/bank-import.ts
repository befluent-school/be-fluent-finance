"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAnthropicClient, isAnthropicConfigured } from "@/lib/anthropic";

export type CategorySuggestion = { description: string; suggestedCategory: string | null };

export type TransferCandidateRow = { date: string; amount: number; type: "CREDIT" | "DEBIT" };

/**
 * Repasses entre as próprias contas da Be Fluent (ex: Asaas -> Inter) aparecem
 * em AMBOS os extratos: uma saída na conta de origem, uma entrada na conta de
 * destino, mesma data, mesmo valor absoluto. Em vez de depender da IA acertar
 * isso via prompt (ela não tem como saber quais são "as próprias contas" do
 * usuário), fazemos o match determinístico: para cada linha do extrato sendo
 * importado, procuramos em cash_transactions já lançadas um par de tipo
 * oposto, mesma data e mesmo valor absoluto. Retorna o índice das linhas que
 * batem, para o preview já vir pré-marcado como transferência.
 */
export async function findTransferMatches(rows: TransferCandidateRow[]): Promise<boolean[]> {
  if (rows.length === 0) return [];

  const supabase = await createClient();
  const dates = Array.from(new Set(rows.map((r) => r.date)));

  const { data: existing } = await supabase
    .from("cash_transactions")
    .select("date, amount, type")
    .in("date", dates)
    .returns<{ date: string; amount: number; type: "entrada" | "saida" }[]>();

  if (!existing || existing.length === 0) return rows.map(() => false);

  // Pool consumível: cada lançamento existente só casa com uma linha do
  // extrato, para não marcar todas as transações de um valor comum (ex: duas
  // mensalidades de mesmo valor no mesmo dia) como transferência de uma vez.
  const pool = [...existing];

  return rows.map((row) => {
    const oppositeType = row.type === "CREDIT" ? "saida" : "entrada";
    const idx = pool.findIndex(
      (e) => e.date === row.date && e.type === oppositeType && Math.abs(e.amount - row.amount) < 0.01
    );
    if (idx === -1) return false;
    pool.splice(idx, 1);
    return true;
  });
}

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
  | { success: true; imported: number; skipped: number }
  | { success: false; error: string };

/**
 * Lança direto no fluxo de caixa as transações já revisadas pelo usuário no
 * preview — sem etapa intermediária de "pendente" aguardando aprovação
 * individual (fluxo anterior era lento demais para extratos com dezenas de
 * linhas). A revisão acontece toda no client antes desta chamada.
 *
 * Deduplicado por (data + descrição original + valor + tipo): reimportar o
 * mesmo extrato, ou uma transação que já apareceu em outra importação,
 * não cria lançamento duplicado — a chave usa a descrição ANTES de anexar
 * o rótulo da conta, para não depender de o usuário digitar o mesmo texto.
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
    dedupe_key: `${r.date}|${r.description.trim().toLowerCase()}|${r.amount}|${r.type}`,
  }));

  const { error, count } = await supabase
    .from("cash_transactions")
    .upsert(cashRows, { onConflict: "dedupe_key", ignoreDuplicates: true, count: "exact" });

  if (error) {
    return { success: false, error: `Erro ao lançar transações: ${error.message}` };
  }

  const imported = count ?? rows.length;

  revalidatePath("/fluxo-de-caixa");
  revalidatePath("/dashboard");
  revalidatePath("/banco/extrato");
  return { success: true, imported, skipped: rows.length - imported };
}
