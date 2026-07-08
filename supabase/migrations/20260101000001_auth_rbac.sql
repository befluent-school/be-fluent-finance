-- Etapa 1: Autenticação, papéis (RBAC) e auditoria
-- Perfis de usuário, um-para-um com auth.users do Supabase

create extension if not exists "pgcrypto";

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
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
  action text not null, -- 'insert' | 'update' | 'delete'
  table_name text not null,
  record_id text,
  old_data jsonb,
  new_data jsonb,
  created_at timestamptz not null default now()
);

-- Mantém profiles.updated_at em dia
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

-- Cria automaticamente um profile quando um novo usuário se registra no Supabase Auth
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, role)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', new.email), 'funcionario');
  return new;
end;
$$;

create trigger trg_on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
