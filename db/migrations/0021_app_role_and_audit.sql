-- Papel da aplicação e auditoria automática.
--
-- `financeiro` (dono do banco) roda migrations e backups.
-- `financeiro_app` é o papel com que o Next.js conecta: LOGIN, sem
-- SUPERUSER e sem BYPASSRLS, e não é dono de nenhuma tabela — por isso as
-- policies de RLS valem para tudo o que a aplicação faz. Os dois papéis são
-- criados fora das migrations (exigem superusuário): deploy/README.md §3.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'financeiro_app') then
    raise exception 'Papel financeiro_app não existe. Crie-o antes (deploy/README.md, seção Banco de dados).';
  end if;
  if exists (select 1 from pg_roles where rolname = 'financeiro_app' and (rolsuper or rolbypassrls)) then
    raise exception 'financeiro_app não pode ser SUPERUSER nem ter BYPASSRLS.';
  end if;
end;
$$;

-- Auditoria de todas as alterações nas tabelas de dados, feita no banco:
-- não depende de cada Server Action lembrar de registrar, e o papel da
-- aplicação não consegue apagar nem editar o histórico.
create or replace function app.audit_row_change()
returns trigger
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare
  row_data jsonb;
begin
  row_data := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  insert into public.audit_log (user_id, action, table_name, record_id, old_data, new_data)
  values (
    -- Só referencia profiles existentes (FK); operações sem usuário (ex.:
    -- scripts administrativos) ficam com user_id nulo.
    (select p.id from public.profiles p where p.id = app.current_user_id()),
    lower(tg_op),
    tg_table_name,
    row_data ->> 'id',
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end
  );
  return null;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'profiles', 'permissions', 'role_permissions',
    'plans', 'teachers', 'students', 'enrollments', 'invoices',
    'cost_categories', 'cash_transactions',
    'revenue_targets', 'student_targets', 'cac_targets', 'ltv_cac_targets',
    'bank_connections', 'bank_transactions_staging', 'reconciliation_rules',
    'bank_statement_imports', 'tasks'
  ]
  loop
    execute format(
      'create trigger trg_%1$s_audit after insert or update or delete on public.%1$I
         for each row execute function app.audit_row_change()', t);
  end loop;
end;
$$;

-- Eventos de autenticação (login, logout, troca de senha, 2FA...). Chamada
-- pelo app em contexto sem usuário (o login ainda não terminou), por isso
-- recebe o user_id explicitamente; só aceita ações com prefixo 'auth.'.
create or replace function app.audit_event(p_user_id uuid, p_action text, p_details jsonb)
returns void
language plpgsql
security definer set search_path = public, pg_temp
as $$
begin
  if p_action is null or p_action not like 'auth.%' then
    raise exception 'app.audit_event aceita apenas ações auth.*';
  end if;
  insert into public.audit_log (user_id, action, table_name, record_id, new_data)
  values (
    (select p.id from public.profiles p where p.id = p_user_id),
    p_action,
    'auth',
    p_user_id::text,
    p_details
  );
end;
$$;

-- Permissões do papel da aplicação ---------------------------------------
revoke all on schema app, iam from public;
grant usage on schema public, app, iam to financeiro_app;

grant select, insert, update, delete on all tables in schema public to financeiro_app;
-- Histórico de auditoria é somente leitura para a aplicação.
revoke insert, update, delete, truncate on public.audit_log from financeiro_app;

grant select, insert, update, delete on all tables in schema iam to financeiro_app;
grant usage on all sequences in schema iam to financeiro_app;

revoke all on all functions in schema app from public;
grant execute on function app.current_user_id(), app.is_authenticated(),
  app.audit_event(uuid, text, jsonb) to financeiro_app;
