-- Etapa 1: Identidade, papéis (RBAC) e auditoria.
-- Convertida do Supabase (20260101000001): `auth.users` deu lugar a
-- `iam.users`, mantida pela autenticação própria do app (lib/auth). Os UUIDs
-- dos usuários migrados do Supabase são preservados, então todas as FKs para
-- profiles continuam válidas.
--
-- Schemas:
--   iam    → credenciais, sessões e 2FA. Acessado só pelo código de
--            autenticação (src/lib/auth), sem RLS: as operações acontecem
--            antes de existir um usuário logado (login, validar sessão).
--   app    → funções auxiliares do RLS (usuário corrente, papel).
--   public → dados financeiros, todos com RLS.

create schema if not exists iam;
create schema if not exists app;

create table iam.users (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  -- scrypt$... (formato próprio, ver src/lib/auth/password.ts). Usuários
  -- migrados chegam com o bcrypt do Supabase ($2a$/$2b$), que é verificado
  -- no login e regravado em scrypt no primeiro acesso.
  password_hash text,
  password_changed_at timestamptz,
  -- Segredo TOTP cifrado com AES-256-GCM (chave derivada de APP_SECRET).
  totp_secret_enc text,
  totp_enabled_at timestamptz,
  -- Último time-step TOTP aceito: impede reutilizar o mesmo código.
  totp_last_step bigint,
  failed_login_count integer not null default 0,
  locked_until timestamptz,
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint users_email_normalized check (email = lower(btrim(email)) and email <> '')
);

create unique index users_email_key on iam.users (email);

create table public.profiles (
  id uuid primary key references iam.users (id) on delete cascade,
  full_name text not null,
  role text not null default 'funcionario' check (role in ('owner', 'socio', 'funcionario')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Permissões extensíveis: em vez de travar comportamento no enum "role",
-- cada papel pode ganhar/perder permissões específicas sem alterar código.
create table public.permissions (
  id uuid primary key default gen_random_uuid(),
  code text not null unique, -- ex: 'view_net_profit', 'manage_users', 'edit_invoices'
  description text not null
);

create table public.role_permissions (
  role text not null check (role in ('owner', 'socio', 'funcionario')),
  permission_id uuid not null references public.permissions (id) on delete cascade,
  primary key (role, permission_id)
);

create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles (id),
  action text not null, -- 'insert' | 'update' | 'delete' | eventos de autenticação ('login', 'logout', ...)
  table_name text not null,
  record_id text,
  old_data jsonb,
  new_data jsonb,
  created_at timestamptz not null default now()
);

create index idx_audit_log_created_at on public.audit_log (created_at);

-- Mantém updated_at em dia
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

create trigger trg_iam_users_updated_at
  before update on iam.users
  for each row execute function public.set_updated_at();

-- O trigger do Supabase que criava o profile ao inserir em auth.users
-- (handle_new_user) não existe mais: usuários e profiles são criados juntos
-- pelo script `npm run user:create` (scripts/create-user.mjs).
