-- RLS: profiles, permissions, role_permissions, audit_log.
-- Convertida do Supabase (20260101000002). Em vez do JWT do Supabase
-- (auth.uid() / auth.role()), o usuário corrente vem de uma variável de
-- transação que o app define a cada operação:
--   begin; select set_config('app.user_id', '<uuid>', true); ...; commit;
-- (ver src/lib/db/index.ts → withUser). O app conecta com o papel
-- `financeiro_app`, que NÃO é dono das tabelas e NÃO tem BYPASSRLS — então
-- estas policies valem para toda consulta feita pela aplicação.

alter table public.profiles enable row level security;
alter table public.permissions enable row level security;
alter table public.role_permissions enable row level security;
alter table public.audit_log enable row level security;

-- Usuário corrente da transação (null quando não definido: nenhuma policy
-- de dados libera acesso nesse caso).
create or replace function app.current_user_id()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('app.user_id', true), '')::uuid;
$$;

-- Helper: papel do usuário autenticado. Perfis desativados não têm papel
-- (no Supabase, desativar o profile não bloqueava nada — agora bloqueia).
create or replace function public.current_role_name()
returns text
language sql
security definer set search_path = public, pg_temp
stable
as $$
  select role from public.profiles where id = app.current_user_id() and active;
$$;

-- Substitui auth.role() = 'authenticated': existe um usuário corrente com
-- profile ativo.
create or replace function app.is_authenticated()
returns boolean
language sql
security definer set search_path = public, pg_temp
stable
as $$
  select exists (select 1 from public.profiles where id = app.current_user_id() and active);
$$;

-- Helper: usuário autenticado tem uma permissão específica
create or replace function public.has_permission(perm_code text)
returns boolean
language sql
security definer set search_path = public, pg_temp
stable
as $$
  select exists (
    select 1
    from public.role_permissions rp
    join public.permissions p on p.id = rp.permission_id
    where rp.role = public.current_role_name()
      and p.code = perm_code
  );
$$;

-- profiles: todo usuário autenticado vê a própria linha; owner vê todas.
create policy "profiles_select_self_or_owner"
  on public.profiles for select
  using (id = app.current_user_id() or public.current_role_name() = 'owner');

-- No Supabase esta policy permitia ao próprio usuário atualizar a sua linha
-- — inclusive a coluna `role` (escalada de privilégio via API REST). Agora
-- só o owner altera profiles.
create policy "profiles_update_owner_only"
  on public.profiles for update
  using (public.current_role_name() = 'owner')
  with check (public.current_role_name() = 'owner');

create policy "profiles_insert_owner_only"
  on public.profiles for insert
  with check (public.current_role_name() = 'owner');

create policy "profiles_delete_owner_only"
  on public.profiles for delete
  using (public.current_role_name() = 'owner');

-- permissions/role_permissions: leitura para todos autenticados, escrita só owner
create policy "permissions_select_authenticated"
  on public.permissions for select
  using (app.is_authenticated());

create policy "permissions_write_owner_only"
  on public.permissions for all
  using (public.current_role_name() = 'owner')
  with check (public.current_role_name() = 'owner');

create policy "role_permissions_select_authenticated"
  on public.role_permissions for select
  using (app.is_authenticated());

create policy "role_permissions_write_owner_only"
  on public.role_permissions for all
  using (public.current_role_name() = 'owner')
  with check (public.current_role_name() = 'owner');

-- audit_log: somente owner lê. Ninguém grava diretamente: as linhas vêm do
-- trigger de auditoria e da função app.audit_event (ambos SECURITY DEFINER,
-- migration 0021) — o papel da aplicação não tem INSERT/UPDATE/DELETE aqui.
create policy "audit_log_select_owner_only"
  on public.audit_log for select
  using (public.current_role_name() = 'owner');
