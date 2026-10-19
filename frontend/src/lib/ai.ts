import "server-only";
import OpenAI from "openai";
import { createAnthropicClient } from "@/lib/anthropic";

/**
 * Provedor de IA do sistema. OpenAI quando OPENAI_API_KEY existe (padrão da
 * Be Fluent); Anthropic como alternativa se só houver ANTHROPIC_API_KEY.
 * O modelo da OpenAI pode ser trocado sem deploy por OPENAI_MODEL.
 */
export type AIProvider = "openai" | "anthropic";

export function aiProvider(): AIProvider | null {
  if (process.env.OPENAI_API_KEY) return "openai";
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  return null;
}

export const isAIConfigured = () => aiProvider() !== null;

export const OPENAI_MODEL = () => process.env.OPENAI_MODEL || "gpt-5";
export const ANTHROPIC_MODEL = "claude-sonnet-5-5";

export function createOpenAIClient() {
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

/** Parâmetros que só modelos de raciocínio (gpt-5, o-series) aceitam. */
export function openAIReasoningParams(model: string): { reasoning_effort?: "low" } {
  return /^(gpt-5|o\d)/.test(model) ? { reasoning_effort: "low" } : {};
}

/** Uma pergunta, uma resposta de texto — usado por insights e sugestões. */
export async function aiText(opts: { system: string; user: string; maxTokens?: number }): Promise<string> {
  const provider = aiProvider();
  if (provider === "openai") {
    const model = OPENAI_MODEL();
    const r = await createOpenAIClient().chat.completions.create({
      model,
      max_completion_tokens: Math.max(opts.maxTokens ?? 2048, 2048),
      ...openAIReasoningParams(model),
      messages: [
        { role: "system", content: opts.system },
        { role: "user", content: opts.user },
      ],
    });
    return r.choices[0]?.message?.content ?? "";
  }
  if (provider === "anthropic") {
    const r = await createAnthropicClient().messages.create({
      model: ANTHROPIC_MODEL,
      max_tokens: opts.maxTokens ?? 2048,
      system: opts.system,
      messages: [{ role: "user", content: opts.user }],
    });
    return r.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { text: string }).text)
      .join("\n");
  }
  throw new Error("IA não configurada");
}
