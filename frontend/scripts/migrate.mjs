#!/usr/bin/env node
// Aplica as migrations SQL de ../db/migrations em ordem, cada uma numa
// transação, registrando versão + checksum em app.schema_migrations.
// Conecta como o DONO do banco (MIGRATION_DATABASE_URL), nunca como o papel
// da aplicação.
//
//   npm run db:migrate            aplica as pendentes
//   npm run db:migrate -- --seed  aplica e roda db/seeds (só desenvolvimento)
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const migrationsDir = join(root, "db", "migrations");
const seedsDir = join(root, "db", "seeds");

const url = process.env.MIGRATION_DATABASE_URL;
if (!url) {
  console.error("MIGRATION_DATABASE_URL não definida (conexão do dono do banco).");
  process.exit(1);
}

const client = new pg.Client({ connectionString: url });
await client.connect();

try {
  await client.query("create schema if not exists app");
  await client.query(`
    create table if not exists app.schema_migrations (
      version text primary key,
      checksum text not null,
      applied_at timestamptz not null default now()
    )`);

  const applied = new Map(
    (await client.query("select version, checksum from app.schema_migrations")).rows.map((r) => [
      r.version,
      r.checksum,
    ])
  );

  const files = readdirSync(migrationsDir)
    .filter((f) => /^\d{4}_.+\.sql$/.test(f))
    .sort();

  let count = 0;
  for (const file of files) {
    const sql = readFileSync(join(migrationsDir, file), "utf8");
    const checksum = createHash("sha256").update(sql).digest("hex");
    const version = file.replace(/\.sql$/, "");

    if (applied.has(version)) {
      if (applied.get(version) !== checksum) {
        throw new Error(
          `Migration ${file} já aplicada foi alterada depois (checksum diferente). ` +
            "Crie uma migration nova em vez de editar uma antiga."
        );
      }
      continue;
    }

    process.stdout.write(`→ ${file} ... `);
    await client.query("begin");
    try {
      await client.query(sql);
      await client.query("insert into app.schema_migrations (version, checksum) values ($1, $2)", [
        version,
        checksum,
      ]);
      await client.query("commit");
    } catch (err) {
      await client.query("rollback");
      console.log("ERRO");
      throw err;
    }
    console.log("ok");
    count++;
  }
  console.log(count === 0 ? "Nenhuma migration pendente." : `${count} migration(s) aplicada(s).`);

  if (process.argv.includes("--seed")) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("--seed é só para desenvolvimento.");
    }
    for (const file of readdirSync(seedsDir).filter((f) => f.endsWith(".sql")).sort()) {
      process.stdout.write(`→ seed ${file} ... `);
      await client.query(readFileSync(join(seedsDir, file), "utf8"));
      console.log("ok");
    }
  }
} finally {
  await client.end();
}
