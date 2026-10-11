import "server-only";
import { and, count, eq, gte, lt, sql } from "drizzle-orm";
import type { Tx } from "@/lib/db";
import { authAttempts } from "@/lib/db/schema";

type Kind = "login" | "mfa" | "password_reset";

/** Limites por janela de tempo. O Nginx aplica um limite extra por IP (deploy/nginx-financeiro.conf). */
export const LIMITS = {
  login: { windowMinutes: 15, perIdentifier: 8, perIp: 30 },
  mfa: { windowMinutes: 15, perIdentifier: 10, perIp: 30 },
  password_reset: { windowMinutes: 60, perIdentifier: 3, perIp: 10 },
} as const;

/**
 * true se o identificador (e-mail/usuário) ou o IP já estourou o limite na
 * janela. Para login/2FA contam só as falhas; para recuperação de senha,
 * todas as solicitações.
 */
export async function isRateLimited(tx: Tx, kind: Kind, identifier: string, ip: string | null): Promise<boolean> {
  const { windowMinutes, perIdentifier, perIp } = LIMITS[kind];
  const since = new Date(Date.now() - windowMinutes * 60_000).toISOString();
  const onlyFailures = kind === "password_reset" ? undefined : eq(authAttempts.success, false);

  const [{ value: byIdentifier }] = await tx
    .select({ value: count() })
    .from(authAttempts)
    .where(and(eq(authAttempts.kind, kind), eq(authAttempts.identifier, identifier), gte(authAttempts.createdAt, since), onlyFailures));
  if (byIdentifier >= perIdentifier) return true;

  if (ip) {
    const [{ value: byIp }] = await tx
      .select({ value: count() })
      .from(authAttempts)
      .where(and(eq(authAttempts.kind, kind), eq(authAttempts.ipAddress, ip), gte(authAttempts.createdAt, since), onlyFailures));
    if (byIp >= perIp) return true;
  }
  return false;
}

export async function recordAttempt(tx: Tx, kind: Kind, identifier: string, ip: string | null, success: boolean) {
  await tx.insert(authAttempts).values({ kind, identifier, ipAddress: ip, success });
  // Limpeza oportunista: registros com mais de 2 dias não servem para nada.
  if (Math.random() < 0.02) {
    await tx.delete(authAttempts).where(lt(authAttempts.createdAt, sql`now() - interval '2 days'`));
  }
}
