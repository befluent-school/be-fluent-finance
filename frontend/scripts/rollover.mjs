#!/usr/bin/env node
// Virada de mês/ano — executado pelo agendador do sistema operacional
// (Task Scheduler no Windows local, cron na VPS). Chama a função SQL
// public.run_monthly_rollover, que faz todo o trabalho de forma idempotente.
//
// Conecta com a URL do DONO do banco (mesma das migrations), nunca com o
// papel da aplicação, porque roda fora de qualquer sessão de usuário.
//
//   npm run rollover               # usa a data de hoje
//   npm run rollover -- 2026-11-01 # força um "hoje" (teste / recuperação)
//
// Sai com código 0 em sucesso (inclusive quando a automação está desligada),
// 1 em erro — o agendador registra a falha.
import pg from "pg";

const url = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
if (!url) {
  console.error("[rollover] MIGRATION_DATABASE_URL (ou DATABASE_URL) não definida.");
  process.exit(1);
}

const todayArg = process.argv[2];
if (todayArg && !/^\d{4}-\d{2}-\d{2}$/.test(todayArg)) {
  console.error(`[rollover] data inválida: ${todayArg} (esperado YYYY-MM-DD)`);
  process.exit(1);
}

const client = new pg.Client({ connectionString: url });
const stamp = () => new Date().toISOString();

try {
  await client.connect();
  const { rows } = todayArg
    ? await client.query("select public.run_monthly_rollover('scheduled', $1::date) as result", [todayArg])
    : await client.query("select public.run_monthly_rollover('scheduled') as result");
  const result = rows[0]?.result ?? {};
  console.log(`[rollover ${stamp()}] ${JSON.stringify(result)}`);
  process.exit(0);
} catch (err) {
  console.error(`[rollover ${stamp()}] ERRO:`, err instanceof Error ? err.message : err);
  process.exit(1);
} finally {
  await client.end().catch(() => {});
}
