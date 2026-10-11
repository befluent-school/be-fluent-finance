import "server-only";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { getPool } from "./pool";
import * as schema from "./schema";

export { schema };

export type Db = NodePgDatabase<typeof schema>;
/** Transação já identificada (RLS ativo para o usuário informado). */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

const globalForDb = globalThis as unknown as { __financeiroDb?: Db };

function db(): Db {
  globalForDb.__financeiroDb ??= drizzle(getPool(), { schema });
  return globalForDb.__financeiroDb;
}

/**
 * Executa `fn` numa transação em nome do usuário: define `app.user_id`
 * apenas para esta transação (set_config(..., true) = SET LOCAL), e as
 * policies de RLS do Postgres filtram o que ele pode ler e gravar.
 *
 * Use só a partir de `requireUser()`/`getActionUser()` (src/lib/auth), que
 * garantem sessão válida com 2FA — nunca com um id vindo do navegador.
 */
export async function withUser<T>(userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db().transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.user_id', ${userId}, true)`);
    return fn(tx);
  });
}

/**
 * Transação SEM usuário: usada só pela autenticação (schema iam) antes de
 * existir sessão. Sem `app.user_id`, o RLS bloqueia toda tabela de dados.
 */
export async function withSystem<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db().transaction(async (tx) => fn(tx));
}

/**
 * Executa consultas da mesma transação uma após a outra (uma conexão só
 * processa uma consulta por vez; o pg@9 deixará de enfileirar chamadas
 * concorrentes). Mantém o formato de tupla do Promise.all.
 */
export async function sequential<const T extends readonly (() => Promise<unknown>)[]>(
  tasks: T
): Promise<{ -readonly [K in keyof T]: Awaited<ReturnType<T[K]>> }> {
  const results: unknown[] = [];
  for (const task of tasks) results.push(await task());
  return results as { -readonly [K in keyof T]: Awaited<ReturnType<T[K]>> };
}
