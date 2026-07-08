-- Etapa 5: Integração bancária via Pluggy (Open Finance).
-- bank_connections: uma linha por "Item" da Pluggy (uma conexão com uma instituição).
-- bank_transactions_staging: transações importadas cruas, aguardando conciliação humana
-- antes de virarem cash_transactions reais — nunca inserimos direto em cash_transactions
-- sem confirmação, para não duplicar/errar categorização silenciosamente.

create table public.bank_connections (
  id uuid primary key default gen_random_uuid(),
  pluggy_item_id text not null unique,
  institution_name text not null,
  status text not null default 'pending' check (status in ('pending', 'updated', 'updating', 'error', 'outdated')),
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.bank_transactions_staging (
  id uuid primary key default gen_random_uuid(),
  bank_connection_id uuid not null references public.bank_connections (id) on delete cascade,
  pluggy_transaction_id text not null unique,
  date date not null,
  description text not null,
  amount numeric(12, 2) not null,
  pluggy_type text not null check (pluggy_type in ('DEBIT', 'CREDIT')),
  -- Após conciliação, aponta para o lançamento definitivo criado; enquanto
  -- null, ainda está pendente de revisão humana na tela de conciliação.
  reconciled_cash_transaction_id uuid references public.cash_transactions (id) on delete set null,
  ignored boolean not null default false,
  created_at timestamptz not null default now()
);

create index idx_staging_bank_connection on public.bank_transactions_staging (bank_connection_id);
create index idx_staging_unreconciled on public.bank_transactions_staging (reconciled_cash_transaction_id) where reconciled_cash_transaction_id is null;

-- Regras automáticas de categorização por palavra-chave, criadas depois que
-- o usuário confirma manualmente a primeira ocorrência de um padrão recorrente
-- (ex: sempre que a descrição contém "NETFLIX", categorizar como "Ferramentas/SaaS").
create table public.reconciliation_rules (
  id uuid primary key default gen_random_uuid(),
  keyword_pattern text not null,
  category_id uuid references public.cost_categories (id),
  auto_apply boolean not null default true,
  created_at timestamptz not null default now()
);

create trigger trg_bank_connections_updated_at before update on public.bank_connections
  for each row execute function public.set_updated_at();

alter table public.bank_connections enable row level security;
alter table public.bank_transactions_staging enable row level security;
alter table public.reconciliation_rules enable row level security;

-- Dados bancários são sensíveis: leitura restrita a owner/socio (não
-- funcionario), escrita só via backend com service role (nenhuma policy de
-- insert/update direta para o client autenticado, exceto marcar conciliado).
create policy "bank_connections_select_owner_or_socio"
  on public.bank_connections for select
  using (public.current_role_name() in ('owner', 'socio'));

create policy "bank_transactions_staging_select_owner_or_socio"
  on public.bank_transactions_staging for select
  using (public.current_role_name() in ('owner', 'socio'));

create policy "bank_transactions_staging_update_owner_or_socio"
  on public.bank_transactions_staging for update
  using (public.current_role_name() in ('owner', 'socio'))
  with check (public.current_role_name() in ('owner', 'socio'));

create policy "reconciliation_rules_select_owner_or_socio"
  on public.reconciliation_rules for select
  using (public.current_role_name() in ('owner', 'socio'));

create policy "reconciliation_rules_write_owner_or_socio"
  on public.reconciliation_rules for all
  using (public.current_role_name() in ('owner', 'socio'))
  with check (public.current_role_name() in ('owner', 'socio'));
