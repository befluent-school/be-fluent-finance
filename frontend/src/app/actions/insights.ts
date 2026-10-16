"use server";

import { sql } from "drizzle-orm";
import { todayBR } from "@/lib/dates";
import { withUser, sequential } from "@/lib/db";
import { getActionUser } from "@/lib/auth/session";
import { Policies } from "@/lib/auth/policies";
import { createAnthropicClient, isAnthropicConfigured } from "@/lib/anthropic";
import {
  countActiveEnrollments,
  countOverdueTasks,
  getCacForMonth,
  getInadimplencia,
  getMonthTargets,
  getMrr,
} from "@/lib/queries/kpis";

export type InsightsResult = { insights: string[] } | { error: string };

const SYSTEM_PROMPT = `Você é um analista financeiro sênior avaliando a saúde financeira de uma escola de mentoria individualizada de inglês para executivos. Seja crítico, direto e específico — nunca genérico, nunca vendedor, nunca use frases de efeito. Aponte com números exatos o que está bom, o que está ruim e qual é o risco mais urgente agora. Se os dados forem insuficientes para uma conclusão, diga isso explicitamente em vez de inventar. Responda em português, em 3 a 5 bullets curtos e objetivos, sem introdução nem conclusão — apenas os bullets.`;

export async function getFinancialInsights(): Promise<InsightsResult> {
  // Mesmo público do dashboard (todos os papéis veem estes indicadores);
  // nenhum dado pessoal de aluno vai para a IA, só agregados.
  const user = await getActionUser(Policies.authenticated);
  if (!user) return { error: "Sem permissão." };

  if (!isAnthropicConfigured()) {
    return { error: "not_configured" };
  }

  const referenceMonth = todayBR().slice(0, 7) + "-01";
  const todayStr = todayBR();

  const data = await withUser(user.id, async (tx) => {
    const [mrr, cacData, inadimplencia, targets, overdueTasks, activeStudents, cash] = await sequential([
      () => getMrr(tx),
      () => getCacForMonth(tx, referenceMonth),
      () => getInadimplencia(tx),
      () => getMonthTargets(tx, referenceMonth),
      () => countOverdueTasks(tx, todayStr),
      () => countActiveEnrollments(tx),
      // Números reais do extrato: faturamento do mês e saldo em caixa hoje.
      async () => {
        const { rows } = await tx.execute<{ receita: string | null; saldo: string | null }>(sql`
          select
            (select receita_calculada from public.v_receita_bruta_mensal
              where reference_month = ${referenceMonth}::date) as receita,
            (select running_balance from public.cash_transactions_with_balance
              where in_balance order by seq desc limit 1) as saldo`);
        return { receita: Number(rows[0]?.receita ?? 0), saldo: Number(rows[0]?.saldo ?? 0) };
      },
    ]);
    return { mrr, cacData, inadimplencia, targets, overdueTasks, activeStudents, cash };
  });

  const { mrr, cacData, inadimplencia, targets, overdueTasks, activeStudents, cash } = data;
  const cac = cacData?.cac ?? 0;

  const summary = `
Dados reais do mês corrente (${referenceMonth.slice(0, 7)}):
- Faturamento do mês até hoje (confirmado nos extratos bancários): R$ ${cash.receita.toFixed(2)}
- MRR (receita recorrente contratada): R$ ${mrr.toFixed(2)}
- Saldo total em caixa hoje (todas as contas): R$ ${cash.saldo.toFixed(2)}
- Meta de faturamento do mês: ${targets.revenueTarget != null ? `R$ ${targets.revenueTarget.toFixed(2)}` : "não definida"}
- Alunos ativos: ${activeStudents}
- CAC do mês: ${cac > 0 ? `R$ ${cac.toFixed(2)}` : "sem gasto de marketing lançado"}
- Meta de CAC máximo: ${targets.maxCac != null ? `R$ ${targets.maxCac.toFixed(2)}` : "não definida"}
- Alunos novos no mês: ${cacData?.new_students ?? 0}
- Meta mínima de LTV:CAC: ${targets.minLtvCacRatio != null ? `${targets.minLtvCacRatio.toFixed(1)}:1` : "não definida"}
- Inadimplência total em aberto: R$ ${inadimplencia.total_atrasado.toFixed(2)} (${inadimplencia.faturas_atrasadas} fatura(s) atrasada(s))
- Tarefas administrativas atrasadas: ${overdueTasks}
`.trim();

  try {
    const client = createAnthropicClient();
    const response = await client.messages.create({
      model: "claude-sonnet-5-5",
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: summary }],
    });

    const text = response.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n");
    const insights = text
      .split("\n")
      .map((line) => line.replace(/^[-•*]\s*/, "").trim())
      .filter(Boolean);

    if (insights.length === 0) {
      return { error: "Não foi possível gerar a análise. Tente novamente." };
    }

    return { insights };
  } catch (err) {
    console.error("[insights] erro ao chamar a IA:", err instanceof Error ? err.message : err);
    // Não repassa a mensagem do provedor ao navegador (pode conter detalhes internos).
    return { error: "Erro ao chamar a IA. Tente novamente em instantes." };
  }
}
