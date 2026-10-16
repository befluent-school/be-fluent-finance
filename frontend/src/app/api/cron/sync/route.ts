import { todayBR } from "@/lib/dates";
import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { env } from "@/lib/env";
import { withUser } from "@/lib/db";
import { safeEqual } from "@/lib/auth/tokens";
import { syncAllActiveProviders } from "@/lib/bank/sync";

/**
 * Endpoint interno chamado pelo agendador do SO (cron na VPS / Task Scheduler)
 * para rodar, em um contexto sem sessão de usuário:
 *   1. a virada de mês (idempotente) — public.run_monthly_rollover
 *   2. a sincronização bancária de todos os providers ativos
 *
 * Protegido por um segredo compartilhado no header `x-cron-secret`
 * (comparação em tempo constante). Sem CRON_SECRET/CRON_USER_ID configurados,
 * responde 503 — o endpoint fica inerte até ser configurado.
 *
 * Nunca cacheado.
 */
export const dynamic = "force-dynamic";

function authorized(req: Request): boolean {
  const secret = env().CRON_SECRET;
  if (!secret) return false;
  const provided = req.headers.get("x-cron-secret") ?? "";
  return safeEqual(provided, secret);
}

async function handle(req: Request): Promise<Response> {
  const cronUser = env().CRON_USER_ID;
  if (!env().CRON_SECRET || !cronUser) {
    return NextResponse.json({ error: "cron não configurado" }, { status: 503 });
  }
  if (!authorized(req)) {
    return NextResponse.json({ error: "não autorizado" }, { status: 401 });
  }

  const today = todayBR();
  try {
    const result = await withUser(cronUser, async (tx) => {
      const { rows } = await tx.execute<{ result: Record<string, unknown> }>(
        sql`select public.run_monthly_rollover('scheduled') as result`
      );
      const rollover = rows[0]?.result ?? {};
      const sync = await syncAllActiveProviders(tx, today);
      return { rollover, sync };
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[cron/sync] erro:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "erro ao executar" }, { status: 500 });
  }
}

export async function POST(req: Request): Promise<Response> {
  return handle(req);
}

// Permite também GET (alguns agendadores só fazem GET), mesma proteção.
export async function GET(req: Request): Promise<Response> {
  return handle(req);
}
