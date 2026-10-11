-- Convertida do Supabase (20260101000005) sem alterações de schema.

-- A coluna invoices.status só é recalculada quando a linha é gravada (trigger),
-- então uma fatura pendente pode "vencer silenciosamente" sem nenhum update
-- disparado. Esta view calcula o status real no momento da consulta,
-- sem depender de um job para ficar em dia.

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
