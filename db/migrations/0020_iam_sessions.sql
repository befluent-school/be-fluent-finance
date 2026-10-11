-- Autenticação própria (substitui o Supabase Auth): sessões, recuperação de
-- senha e registro de tentativas para rate limit.

-- Sessão = cookie HttpOnly com token aleatório; o banco guarda só o
-- SHA-256 do token (um vazamento do banco não entrega sessões válidas).
-- Login em duas etapas: a sessão nasce com mfa_verified_at = null e só dá
-- acesso aos dados depois do código TOTP (ou de backup).
create table iam.sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references iam.users (id) on delete cascade,
  token_hash text not null unique,
  mfa_verified_at timestamptz,
  -- Tentativas de código 2FA erradas nesta sessão (a sessão é encerrada no limite).
  mfa_failed_attempts integer not null default 0,
  -- Cadastro do 2FA por quem ainda não tem autenticador (usuário novo ou
  -- migrado do Supabase): além da senha, exige um código enviado ao e-mail
  -- da conta — quem só descobriu a senha não consegue registrar o próprio
  -- autenticador. Guardamos só o hash do código.
  enroll_code_hash text,
  enroll_code_expires_at timestamptz,
  created_at timestamptz not null default now(),
  last_used_at timestamptz not null default now(),
  -- Expiração deslizante (renovada com o uso) e teto absoluto.
  expires_at timestamptz not null,
  absolute_expires_at timestamptz not null,
  ip_address text,
  user_agent text
);

create index idx_sessions_user_id on iam.sessions (user_id);
create index idx_sessions_expires_at on iam.sessions (expires_at);

-- Link de redefinição de senha: uso único, curta duração, só o hash do token.
create table iam.password_reset_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references iam.users (id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  requested_ip text,
  created_at timestamptz not null default now()
);

create index idx_password_reset_tokens_user_id on iam.password_reset_tokens (user_id);

-- Tentativas de autenticação (login, 2FA, recuperação de senha) para rate
-- limit por e-mail e por IP. Linhas antigas são apagadas pelo próprio app.
create table iam.auth_attempts (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('login', 'mfa', 'password_reset')),
  identifier text not null, -- e-mail normalizado ou id do usuário
  ip_address text,
  success boolean not null,
  created_at timestamptz not null default now()
);

create index idx_auth_attempts_identifier on iam.auth_attempts (kind, identifier, created_at);
create index idx_auth_attempts_ip on iam.auth_attempts (kind, ip_address, created_at);
