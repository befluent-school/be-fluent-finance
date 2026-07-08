-- RLS: cost_categories, cash_transactions.
-- Leitura liberada para todo autenticado; escrita restrita a quem tem
-- 'manage_invoices' (mesma permissão operacional usada em mensalidades) ou
-- é owner/socio (categorias são configuração, não lançamento do dia a dia).

alter table public.cost_categories enable row level security;
alter table public.cash_transactions enable row level security;

create policy "cost_categories_select_authenticated"
  on public.cost_categories for select
  using (auth.role() = 'authenticated');

create policy "cost_categories_write_owner_or_socio"
  on public.cost_categories for all
  using (public.current_role_name() in ('owner', 'socio'))
  with check (public.current_role_name() in ('owner', 'socio'));

create policy "cash_transactions_select_authenticated"
  on public.cash_transactions for select
  using (auth.role() = 'authenticated');

create policy "cash_transactions_write_with_permission"
  on public.cash_transactions for all
  using (public.has_permission('manage_invoices'))
  with check (public.has_permission('manage_invoices'));
