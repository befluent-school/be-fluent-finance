-- Convertida do Supabase (20260101000017) sem alterações de schema.

-- Substitui a integração via Pluggy (custo mínimo de produção R$2.500/mês,
-- inviável para o porte da escola) por importação manual de extrato
-- (CSV/OFX) com conciliação assistida — reaproveita a tabela de staging já
-- existente, generalizada para não depender mais de um "Item" Pluggy.

create table public.bank_statement_imports (
  id uuid primary key default gen_random_uuid(),
  account_label text not null, -- ex: "Asaas", "Banco Inter"
  format text not null check (format in ('csv', 'ofx')),
  filename text,
  imported_at timestamptz not null default now()
);

alter table public.bank_transactions_staging
  alter column bank_connection_id drop not null,
  alter column pluggy_transaction_id drop not null,
  add column import_id uuid references public.bank_statement_imports (id) on delete cascade,
  -- Extratos importados manualmente não têm um ID estável de transação como
  -- a Pluggy fornecia — usamos um hash de (import_id, date, description,
  -- amount) para evitar duplicar linhas ao reimportar o mesmo extrato.
  add column import_dedupe_key text;

create unique index idx_staging_import_dedupe
  on public.bank_transactions_staging (import_dedupe_key)
  where import_dedupe_key is not null;

alter table public.cash_transactions drop constraint cash_transactions_source_check;
alter table public.cash_transactions add constraint cash_transactions_source_check
  check (source in ('manual', 'pluggy', 'manual_import'));

alter table public.bank_statement_imports enable row level security;

create policy "bank_statement_imports_select_owner_or_socio"
  on public.bank_statement_imports for select
  using (public.current_role_name() in ('owner', 'socio'));

create policy "bank_statement_imports_write_owner_or_socio"
  on public.bank_statement_imports for all
  using (public.current_role_name() in ('owner', 'socio'))
  with check (public.current_role_name() in ('owner', 'socio'));

-- A importação manual precisa inserir na tabela de staging diretamente do
-- client autenticado (antes só o webhook, via service role, inserida aqui).
create policy "bank_transactions_staging_insert_owner_or_socio"
  on public.bank_transactions_staging for insert
  with check (public.current_role_name() in ('owner', 'socio'));
