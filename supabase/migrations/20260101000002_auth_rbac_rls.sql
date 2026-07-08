-- RLS: profiles, permissions, role_permissions, audit_log

alter table public.profiles enable row level security;
alter table public.permissions enable row level security;
alter table public.role_permissions enable row level security;
alter table public.audit_log enable row level security;

-- Helper: papel do usuário autenticado
create or replace function public.current_role_name()
returns text
language sql
security definer set search_path = public
stable
as $$
  select role from public.profiles where id = auth.uid();
$$;

-- Helper: usuário autenticado tem uma permissão específica
create or replace function public.has_permission(perm_code text)
returns boolean
language sql
security definer set search_path = public
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

-- profiles: todo usuário autenticado vê a própria linha;
-- owner vê e gerencia todas.
create policy "profiles_select_self_or_owner"
  on public.profiles for select
  using (id = auth.uid() or public.current_role_name() = 'owner');

create policy "profiles_update_self_or_owner"
  on public.profiles for update
  using (id = auth.uid() or public.current_role_name() = 'owner');

create policy "profiles_insert_owner_only"
  on public.profiles for insert
  with check (public.current_role_name() = 'owner');

create policy "profiles_delete_owner_only"
  on public.profiles for delete
  using (public.current_role_name() = 'owner');

-- permissions/role_permissions: leitura para todos autenticados, escrita só owner
create policy "permissions_select_authenticated"
  on public.permissions for select
  using (auth.role() = 'authenticated');

create policy "permissions_write_owner_only"
  on public.permissions for all
  using (public.current_role_name() = 'owner')
  with check (public.current_role_name() = 'owner');

create policy "role_permissions_select_authenticated"
  on public.role_permissions for select
  using (auth.role() = 'authenticated');

create policy "role_permissions_write_owner_only"
  on public.role_permissions for all
  using (public.current_role_name() = 'owner')
  with check (public.current_role_name() = 'owner');

-- audit_log: somente owner lê; qualquer usuário autenticado pode inserir
-- (o backend grava em nome do usuário atual via service role ou RPC)
create policy "audit_log_select_owner_only"
  on public.audit_log for select
  using (public.current_role_name() = 'owner');

create policy "audit_log_insert_authenticated"
  on public.audit_log for insert
  with check (auth.role() = 'authenticated');
