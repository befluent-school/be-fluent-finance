import { existsSync } from "node:fs";
import path from "node:path";
import pg from "pg";

// Carrega as conexões do ambiente local (cluster na porta 5435).
for (const file of [".env.local", ".env.development.local"]) {
  const full = path.resolve(__dirname, "../..", file);
  if (existsSync(full)) process.loadEnvFile(full);
}

const appUrl = process.env.DATABASE_URL;
const ownerUrl = process.env.MIGRATION_DATABASE_URL;
if (!appUrl || !ownerUrl) {
  throw new Error("Testes de banco exigem DATABASE_URL (financeiro_app) e MIGRATION_DATABASE_URL (dono).");
}

export const appPool = new pg.Pool({ connectionString: appUrl, max: 4 });
export const ownerPool = new pg.Pool({ connectionString: ownerUrl, max: 2 });

/**
 * Executa `fn` como o papel da aplicação, identificado como `userId` (ou
 * anônimo), exatamente como src/lib/db/index.ts faz — e desfaz tudo no fim.
 */
export async function asUser<T>(userId: string | null, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await appPool.connect();
  try {
    await client.query("begin");
    if (userId) await client.query("select set_config('app.user_id', $1, true)", [userId]);
    return await fn(client);
  } finally {
    await client.query("rollback").catch(() => {});
    client.release();
  }
}

/** Erro SQLSTATE de uma consulta que deve falhar (ou null se passou). */
export async function sqlState(c: pg.PoolClient, query: string, params: unknown[] = []): Promise<string | null> {
  await c.query("savepoint probe");
  try {
    await c.query(query, params);
    await c.query("release savepoint probe");
    return null;
  } catch (err) {
    await c.query("rollback to savepoint probe");
    return (err as { code?: string }).code ?? "unknown";
  }
}

/** Garante um usuário de teste (idempotente) e devolve o id. */
export async function ensureUser(email: string, role: "owner" | "socio" | "funcionario", active = true): Promise<string> {
  const { rows } = await ownerPool.query(
    `insert into iam.users (email) values ($1)
       on conflict (email) do update set email = excluded.email
     returning id`,
    [email]
  );
  const id = rows[0].id as string;
  await ownerPool.query(
    `insert into public.profiles (id, full_name, role, active) values ($1, $2, $3, $4)
       on conflict (id) do update set role = excluded.role, active = excluded.active`,
    [id, `Teste ${role}`, role, active]
  );
  return id;
}
