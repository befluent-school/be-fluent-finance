-- Convertida do Supabase (20260101000016) sem alterações de schema.

-- Multa (10%) e juros (1%/mês pro-rata) sobre mensalidades pagas com atraso.
-- total_paid guarda o valor efetivamente recebido (amount + multa + juros);
-- fica null até a fatura ser paga.
alter table public.invoices
  add column late_fee_amount numeric(10, 2) not null default 0,
  add column interest_amount numeric(10, 2) not null default 0,
  add column total_paid numeric(10, 2);
