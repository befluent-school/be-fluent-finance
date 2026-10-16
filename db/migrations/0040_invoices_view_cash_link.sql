-- Recria invoices_with_effective_status para expor invoices.cash_transaction_id
-- (o `i.*` de uma view é fixado na criação e não inclui colunas novas).
-- v_inadimplencia_atual depende dela e é recriada igual à 0011.

drop view if exists public.v_inadimplencia_atual;
drop view if exists public.invoices_with_effective_status;

create view public.invoices_with_effective_status
with (security_invoker = true) as
select
  i.*,
  case
    when i.paid_date is not null then 'pago'
    when i.due_date < current_date then 'atrasado'
    else 'pendente'
  end as effective_status
from public.invoices i;

create view public.v_inadimplencia_atual
with (security_invoker = true) as
select
  coalesce(sum(amount), 0) as total_atrasado,
  count(*) as faturas_atrasadas
from public.invoices_with_effective_status
where effective_status = 'atrasado';

grant select on public.invoices_with_effective_status, public.v_inadimplencia_atual to financeiro_app;
