import "server-only";
import { headers } from "next/headers";
import { appOrigin, env } from "@/lib/env";
import { isAllowedOrigin } from "@/lib/request-rules";

export type RequestInfo = { ip: string | null; userAgent: string | null };

/**
 * IP real do cliente. Atrás do Nginx (TRUST_PROXY=1) vem do X-Real-IP que o
 * próprio Nginx define (`include proxy_params`); sem proxy confiável, não
 * acreditamos em cabeçalhos que o cliente pode forjar.
 */
export async function requestInfo(): Promise<RequestInfo> {
  const h = await headers();
  const ip = env().TRUST_PROXY ? (h.get("x-real-ip")?.trim() || null) : null;
  return { ip, userAgent: h.get("user-agent")?.slice(0, 300) ?? null };
}

export class CsrfError extends Error {
  constructor() {
    super("Requisição bloqueada: origem não permitida.");
  }
}

/** Proteção CSRF em Server Actions: a origem precisa ser a URL pública do app. */
export async function assertSameOrigin(): Promise<void> {
  const h = await headers();
  if (!isAllowedOrigin(h.get("origin"), h.get("sec-fetch-site"), appOrigin())) {
    throw new CsrfError();
  }
}
