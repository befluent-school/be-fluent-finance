#!/usr/bin/env node
// Administração de usuários (substitui o painel de Auth do Supabase).
// Roda no servidor com a conexão do DONO do banco (MIGRATION_DATABASE_URL).
// Nenhuma senha passa pela linha de comando: o usuário define a própria
// senha por um link de uso único.
//
//   npm run user -- list
//   npm run user -- create --email ana@befluent.com.br --name "Ana Souza" --role funcionario
//   npm run user -- reset-link --email ana@befluent.com.br      (novo link de senha, 24 h)
//   npm run user -- reset-2fa  --email ana@befluent.com.br      (perdeu celular E códigos de backup)
//   npm run user -- set-role   --email ana@befluent.com.br --role socio
//   npm run user -- deactivate --email ana@befluent.com.br      (bloqueia e encerra sessões)
//   npm run user -- activate   --email ana@befluent.com.br
import { createHash, randomBytes } from "node:crypto";
import { parseArgs } from "node:util";
import pg from "pg";

const ROLES = ["owner", "socio", "funcionario"];
const LINK_HOURS = 24;

const [command, ...rest] = process.argv.slice(2);
const { values: args } = parseArgs({
  args: rest,
  options: { email: { type: "string" }, name: { type: "string" }, role: { type: "string" } },
  strict: true,
});

const url = process.env.MIGRATION_DATABASE_URL;
const appUrl = process.env.NEXT_PUBLIC_APP_URL;
if (!url) fail("MIGRATION_DATABASE_URL não definida.");

function fail(message) {
  console.error(`Erro: ${message}`);
  process.exit(1);
}

const email = args.email?.trim().toLowerCase();
const needEmail = () => email || fail("informe --email");
const needRole = () => (ROLES.includes(args.role ?? "") ? args.role : fail(`--role deve ser ${ROLES.join(" | ")}`));

const client = new pg.Client({ connectionString: url });
await client.connect();

async function userId() {
  const { rows } = await client.query("select id from iam.users where email = $1", [needEmail()]);
  if (!rows[0]) fail(`usuário ${email} não encontrado.`);
  return rows[0].id;
}

async function resetLink(id) {
  const token = randomBytes(32).toString("base64url");
  await client.query("delete from iam.password_reset_tokens where user_id = $1", [id]);
  await client.query(
    `insert into iam.password_reset_tokens (user_id, token_hash, expires_at)
     values ($1, $2, now() + make_interval(hours => $3))`,
    [id, createHash("sha256").update(token).digest("hex"), LINK_HOURS]
  );
  const base = appUrl ?? "https://SEU-DOMINIO";
  console.log(`\nLink para definir a senha (uso único, válido por ${LINK_HOURS} h):`);
  console.log(`${base}/redefinir-senha?token=${token}\n`);
  console.log("Envie por um canal privado. Depois de definir a senha, o usuário cadastra o 2FA no primeiro login.");
}

async function audit(id, action, details = {}) {
  await client.query(
    "insert into public.audit_log (user_id, action, table_name, record_id, new_data) values ($1, $2, 'auth', $3, $4)",
    [id, action, id, JSON.stringify({ ...details, via: "scripts/user-admin.mjs" })]
  );
}

try {
  switch (command) {
    case "list": {
      const { rows } = await client.query(`
        select u.email, p.full_name, p.role, p.active,
               (u.password_hash is not null) as has_password,
               (u.totp_enabled_at is not null) as has_2fa,
               u.last_login_at
          from iam.users u left join public.profiles p on p.id = u.id
         order by u.email`);
      console.table(rows);
      break;
    }
    case "create": {
      const role = needRole();
      if (!args.name?.trim()) fail("informe --name");
      await client.query("begin");
      const { rows } = await client.query("insert into iam.users (email) values ($1) returning id", [needEmail()]);
      await client.query("insert into public.profiles (id, full_name, role) values ($1, $2, $3)", [
        rows[0].id,
        args.name.trim(),
        role,
      ]);
      await audit(rows[0].id, "auth.user_created", { role });
      await client.query("commit");
      console.log(`Usuário ${email} criado (${role}).`);
      await resetLink(rows[0].id);
      break;
    }
    case "reset-link": {
      await resetLink(await userId());
      break;
    }
    case "reset-2fa": {
      const id = await userId();
      await client.query("begin");
      await client.query(
        "update iam.users set totp_secret_enc = null, totp_enabled_at = null, totp_last_step = null where id = $1",
        [id]
      );
      await client.query("delete from iam.mfa_backup_codes where user_id = $1", [id]);
      await client.query("delete from iam.sessions where user_id = $1", [id]);
      await audit(id, "auth.mfa_reset_by_admin");
      await client.query("commit");
      console.log(`2FA de ${email} removido. No próximo login ele recadastra (com código enviado ao e-mail).`);
      break;
    }
    case "set-role": {
      const role = needRole();
      const id = await userId();
      await client.query("update public.profiles set role = $2 where id = $1", [id, role]);
      await audit(id, "auth.role_changed", { role });
      console.log(`Papel de ${email} agora é ${role}.`);
      break;
    }
    case "deactivate":
    case "activate": {
      const id = await userId();
      const active = command === "activate";
      await client.query("update public.profiles set active = $2 where id = $1", [id, active]);
      if (!active) await client.query("delete from iam.sessions where user_id = $1", [id]);
      await audit(id, active ? "auth.user_activated" : "auth.user_deactivated");
      console.log(`${email} ${active ? "reativado" : "desativado (sessões encerradas)"}.`);
      break;
    }
    default:
      fail("comando: list | create | reset-link | reset-2fa | set-role | deactivate | activate");
  }
} catch (err) {
  await client.query("rollback").catch(() => {});
  fail(err instanceof Error ? err.message : String(err));
} finally {
  await client.end();
}
