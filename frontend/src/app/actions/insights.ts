"use server";

import { createClient } from "@/lib/supabase/server";
import { createAnthropicClient, isAnthropicConfigured } from "@/lib/anthropic";

export type InsightsResult = { insights: string[] } | { error: string };

const SYSTEM_PROMPT = `Você é um analista financeiro sênior avaliando a saúde financeira de uma escola de mentoria individualizada de inglês para executivos. Seja crítico, direto e específico — nunca genérico, nunca vendedor, nunca use frases de efeito. Aponte com números exatos o que está bom, o que está ruim e qual é o risco mais urgente agora. Se os dados forem insuficientes para uma conclusão, diga isso explicitamente em vez de inventar. Responda em português, em 3 a 5 bullets curtos e objetivos, sem introdução nem conclusão — apenas os bullets.`;

export async function getFinancialInsights(): Promise<InsightsResult> {
  if (!isAnthropicConfigured()) {
    return { error: "not_configured" };
  }

  const supabase = await createClient();
  const referenceMonth = new Date().toISOString().slice(0, 7) + "-01";
  const todayStr = new Date().toISOString().slice(0, 10);

  const [
    { data: mrrData },
    { data: cacData },
    { data: inadimplenciaData },
    { data: revenueTarget },
    { data: cacTarget },
    { data: ltvCacTarget },
    { count: overdueTasksCount },
    { count: activeStudents },
  ] = await Promise.all([
    supabase.from("v_mrr").select("mrr").single(),
    supabase
      .from("v_cac_by_month")
      .select("*")
      .eq("reference_month", referenceMonth)
      .maybeSingle(),
    supabase.from("v_inadimplencia_atual").select("*").single(),
    supabase
      .from("revenue_targets")
      .select("target_amount")
      .eq("reference_month", referenceMonth)
      .maybeSingle(),
    supabase
      .from("cac_targets")
      .select("max_cac")
      .eq("reference_month", referenceMonth)
      .maybeSingle(),
    supabase
      .from("ltv_cac_targets")
      .select("min_ratio")
      .eq("reference_month", referenceMonth)
      .maybeSingle(),
    supabase
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .eq("completed", false)
      .lt("due_date", todayStr),
    supabase.from("enrollments").select("id", { count: "exact", head: true }).eq("status", "active"),
  ]);

  const mrr = mrrData?.mrr ?? 0;
  const cac = cacData?.cac ?? 0;

  const summary = `
Dados reais do mês corrente (${referenceMonth.slice(0, 7)}):
- MRR (receita recorrente mensal): R$ ${mrr.toFixed(2)}
- Meta de faturamento do mês: ${revenueTarget?.target_amount != null ? `R$ ${revenueTarget.target_amount.toFixed(2)}` : "não definida"}
- Alunos ativos: ${activeStudents ?? 0}
- CAC do mês: ${cac > 0 ? `R$ ${cac.toFixed(2)}` : "sem gasto de marketing lançado"}
- Meta de CAC máximo: ${cacTarget?.max_cac != null ? `R$ ${cacTarget.max_cac.toFixed(2)}` : "não definida"}
- Alunos novos no mês: ${cacData?.new_students ?? 0}
- Meta mínima de LTV:CAC: ${ltvCacTarget?.min_ratio != null ? `${ltvCacTarget.min_ratio.toFixed(1)}:1` : "não definida"}
- Inadimplência total em aberto: R$ ${(inadimplenciaData?.total_atrasado ?? 0).toFixed(2)} (${inadimplenciaData?.faturas_atrasadas ?? 0} fatura(s) atrasada(s))
- Tarefas administrativas atrasadas: ${overdueTasksCount ?? 0}
`.trim();

  try {
    const client = createAnthropicClient();
    const response = await client.messages.create({
      model: "claude-sonnet-5",
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
    return {
      error: `Erro ao chamar a IA: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
