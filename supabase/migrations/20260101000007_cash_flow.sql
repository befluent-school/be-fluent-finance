-- Etapa 3: Fluxo de caixa manual.
-- Substitui as 12 abas mensais "FLUXO DE CAIXA" da planilha por uma única
-- tabela de lançamentos; o saldo acumulado é calculado via view, nunca
-- gravado como coluna (evita o bug de recálculo manual que a planilha tinha).

create table public.cost_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  type text not null check (type in ('fixed', 'variable')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.cash_transactions (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  description text not null,
  category_id uuid references public.cost_categories (id),
  amount numeric(10, 2) not null check (amount > 0),
  type text not null check (type in ('entrada', 'saida')),
  payment_method text check (payment_method in ('pix', 'cartao', 'boleto', 'transferencia')),
  invoice_id uuid references public.invoices (id),
  source text not null default 'manual' check (source in ('manual', 'pluggy')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_cash_transactions_date on public.cash_transactions (date);
create index idx_cash_transactions_type on public.cash_transactions (type);
create index idx_cash_transactions_invoice_id on public.cash_transactions (invoice_id);

create trigger trg_cash_transactions_updated_at before update on public.cash_transactions
  for each row execute function public.set_updated_at();

-- Saldo acumulado calculado por ordem cronológica (data, depois criação para
-- desempate), nunca armazenado — elimina a classe de bug em que o saldo da
-- planilha ficava dessincronizado depois de uma edição retroativa.
create view public.cash_transactions_with_balance
with (security_invoker = true) as
select
  ct.*,
  sum(case when ct.type = 'entrada' then ct.amount else -ct.amount end)
    over (order by ct.date, ct.created_at) as running_balance
from public.cash_transactions ct;
