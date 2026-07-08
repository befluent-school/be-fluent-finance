import "server-only";
import OpenAI from "openai";

export function isOpenAiConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}

export function createOpenAiClient() {
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}
