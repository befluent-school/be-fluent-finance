import "server-only";
import pg from "pg";
import { env } from "@/lib/env";

// Conversões globais do driver para manter os mesmos tipos que o PostgREST
// (Supabase) entregava ao código: numeric/bigint como number e date como
// string 'YYYY-MM-DD' (sem fuso — um Date do JS deslocaria o dia).
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (v) => (v === null ? null : Number(v)));
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => (v === null ? null : Number(v)));
pg.types.setTypeParser(pg.types.builtins.DATE, (v) => v);

const globalForPool = globalThis as unknown as { __financeiroPool?: pg.Pool };

/**
 * Pool único do processo (o `globalThis` evita abrir um pool novo a cada
 * recarga do dev server). Conecta com o papel `financeiro_app`, sujeito ao
 * RLS — nunca use aqui a URL do dono do banco.
 */
export function getPool(): pg.Pool {
  if (!globalForPool.__financeiroPool) {
    globalForPool.__financeiroPool = new pg.Pool({
      connectionString: env().DATABASE_URL,
      max: 10,
      idleTimeoutMillis: 30_000,
      // Uma consulta travada não deve segurar a conexão para sempre.
      statement_timeout: 30_000,
      application_name: "financeiro-web",
    });
  }
  return globalForPool.__financeiroPool;
}
