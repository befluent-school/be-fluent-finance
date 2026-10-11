-- Códigos de backup para recuperação do 2FA.
-- Convertida do Supabase (20260101000003). A tabela saiu de `public` para
-- `iam`: o código de backup é conferido durante o login, antes de existir
-- um usuário autenticado (as policies por auth.uid() deixaram de fazer
-- sentido). Guardamos só o HMAC-SHA256 (com segredo do servidor) de cada
-- código, nunca o valor em texto puro — sem o segredo, o hash não pode ser
-- quebrado por força bruta offline.
--
-- Os códigos do Supabase NÃO são migrados: pertenciam ao fator TOTP antigo,
-- e todo usuário recadastra o 2FA no primeiro login na VPS.

create table iam.mfa_backup_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references iam.users (id) on delete cascade,
  code_hash text not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index idx_mfa_backup_codes_user_id on iam.mfa_backup_codes (user_id);
