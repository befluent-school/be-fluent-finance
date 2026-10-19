"use server";

import { revalidatePath } from "next/cache";
import * as z from "zod";
import { inArray, sql } from "drizzle-orm";
import { withUser } from "@/lib/db";
import { bankProviders, cashTransactions } from "@/lib/db/schema";
import { logDbError } from "@/lib/db/errors";
import { FORBIDDEN_MESSAGE, getActionUser } from "@/lib/auth/session";
import { Policies } from "@/lib/auth/policies";
import { isoDate } from "@/lib/validation";
import { createAnthropicClient, isAnthropicConfigured } from "@/lib/anthropic";

// Importação de extrato é conciliação bancária: owner e sócio (mesma regra
// da página /banco/conciliacao e do RLS de bank_statement_imports).
const POLICY = Policies.ownerOrSocio;
const MAX_ROWS = 5000;

export type CategorySuggestion = { description: string; suggestedCategory: string | null };

export type TransferCandidateRow = { date: string; amount: number; type: "CREDIT" | "DEBIT" };

const TransferRowsSchema = z
  .array(
    z.object({
      date: isoDate,
      amount: z.number().finite().nonnegative().max(99_999_999.99),
      type: z.enum(["CREDIT", "DEBIT"]),
    })
  )
  .max(MAX_ROWS);

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
  const user = await getActionUser(POLICY);
  if (!user) return [];
  const parsed = TransferRowsSchema.safeParse(rows);
  if (!parsed.success || parsed.data.length === 0) return [];

  const dates = Array.from(new Set(parsed.data.map((r) => r.date)));

  const existing = await withUser(user.id, (tx) =>
    tx
      .select({ date: cashTransactions.date, amount: cashTransactions.amount, type: cashTransactions.type })
      .from(cashTransactions)
      .where(inArray(cashTransactions.date, dates))
  );

  if (existing.length === 0) return parsed.data.map(() => false);

  // Pool consumível: cada lançamento existente só casa com uma linha do
  // extrato, para não marcar todas as transações de um valor comum (ex: duas
  // mensalidades de mesmo valor no mesmo dia) como transferência de uma vez.
  const pool = [...existing];

  return parsed.data.map((row) => {
    const oppositeType = row.type === "CREDIT" ? "saida" : "entrada";
    const idx = pool.findIndex(
      (e) => e.date === row.date && e.type === oppositeType && Math.abs(e.amount - row.amount) < 0.01
    );
    if (idx === -1) return false;
    pool.splice(idx, 1);
    return true;
  });
}

const SuggestSchema = z.object({
  descriptions: z.array(z.string().max(500)).max(MAX_ROWS),
  categories: z.array(z.string().max(100)).max(300),
});

/**
 * Sugere a categoria mais provável para cada linha do extrato, com base na
 * descrição — só preenche um valor sugerido e editável no preview, nunca é
 * aplicado sem o usuário revisar e confirmar o lote.
 */
export async function suggestCategoriesForImport(
  descriptions: string[],
  availableCategories: string[]
): Promise<CategorySuggestion[]> {
  const user = await getActionUser(POLICY);
  const parsed = SuggestSchema.safeParse({ descriptions, categories: availableCategories });
  if (!user || !parsed.success) {
    return (Array.isArray(descriptions) ? descriptions : []).map((description) => ({
      description: String(description),
      suggestedCategory: null,
    }));
  }
  const list = parsed.data.descriptions;
  const categories = parsed.data.categories;

  if (!isAnthropicConfigured() || list.length === 0) {
    return list.map((description) => ({ description, suggestedCategory: null }));
  }

  try {
    const client = createAnthropicClient();
    const response = await client.messages.create({
      model: "claude-sonnet-5-5",
      max_tokens: 2048,
      system: `Você categoriza lançamentos de extrato bancário de uma escola de mentoria de inglês. Categorias disponíveis: ${categories.join(", ")}. Para cada descrição numerada, responda APENAS com o número seguido de ":" e o nome exato de uma categoria da lista (ou "Nenhuma" se não tiver certeza). Uma linha por item, sem texto extra.`,
      messages: [
        {
          role: "user",
          content: list.map((d, i) => `${i + 1}: ${d}`).join("\n"),
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
        // Só aceita nomes que existem na lista (a resposta da IA nunca vira dado sem validação).
        if (category !== "Nenhuma" && categories.includes(category)) {
          suggestions.set(Number(match[1]), category);
        }
      }
    }

    return list.map((description, i) => ({
      description,
      suggestedCategory: suggestions.get(i + 1) ?? null,
    }));
  } catch {
    return list.map((description) => ({ description, suggestedCategory: null }));
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

const ConfirmSchema = z.object({
  accountLabel: z.string().trim().min(1).max(100),
  rows: z
    .array(
      z.object({
        date: isoDate,
        description: z.string().trim().min(1).max(500),
        amount: z.number().finite().positive().max(99_999_999.99),
        type: z.enum(["CREDIT", "DEBIT"]),
        categoryId: z.uuid().nullable(),
      })
    )
    .min(1)
    .max(MAX_ROWS),
});

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
  const user = await getActionUser(POLICY);
  if (!user) return { success: false, error: FORBIDDEN_MESSAGE };

  if (!Array.isArray(rows) || rows.length === 0) {
    return { success: false, error: "Nenhuma transação para importar." };
  }
  const parsed = ConfirmSchema.safeParse({ accountLabel, rows });
  if (!parsed.success) {
    return { success: false, error: "Dados do extrato inválidos. Revise as linhas e tente novamente." };
  }

  const label = parsed.data.accountLabel;
  const norm = (v: string) => v.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const cashRows = parsed.data.rows.map((r) => ({
    date: r.date,
    description: `${r.description} (${parsed.data.accountLabel})`,
    categoryId: r.categoryId,
    amount: r.amount,
    type: r.type === "CREDIT" ? ("entrada" as const) : ("saida" as const),
    source: "manual_import",
    dedupeKey: `${r.date}|${r.description.trim().toLowerCase()}|${r.amount}|${r.type}`,
  }));

  try {
    const inserted = await withUser(user.id, async (tx) => {
      // Extrato de uma conta conectada (ex.: "Banco Inter"): liga os lançamentos
      // a ela, para entrarem no saldo e na conferência daquela conta.
      const providers = await tx
        .select({ id: bankProviders.id, label: bankProviders.label, provider: bankProviders.provider })
        .from(bankProviders);
      const match = providers.find(
        (p) => norm(label).includes(norm(p.provider)) || norm(p.label).includes(norm(label)) || norm(label).includes(norm(p.label))
      );
      const rows = await tx
        .insert(cashTransactions)
        .values(cashRows.map((row) => ({ ...row, bankProviderId: match?.id ?? null })))
        .onConflictDoNothing({ target: cashTransactions.dedupeKey })
        .returning({ id: cashTransactions.id });
      // Regras aprendidas valem também para o que chega por extrato.
      if (rows.length > 0) await tx.execute(sql`select public.categorizar_lancamentos_bancarios()`);
      return rows;
    });

    revalidatePath("/fluxo-de-caixa");
    revalidatePath("/dashboard");
    revalidatePath("/banco/conciliacao");
    return { success: true, imported: inserted.length, skipped: cashRows.length - inserted.length };
  } catch (err) {
    logDbError("confirmBankImport", err);
    return { success: false, error: "Erro ao lançar transações. Nada foi importado." };
  }
}
