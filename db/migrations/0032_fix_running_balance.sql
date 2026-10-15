-- Corrige o saldo acumulado no Fluxo de Caixa.
--
-- Problema: transferências internas (ex: ASAAS → Inter PJ) aparecem como
-- saída no ASAAS e como entrada no Inter, ambas somadas na window function.
-- Resultado: um Pix de R$ 13.050 inflava o saldo em ~R$ 26.100.
--
-- Solução: a running_balance ignora lançamentos classificados como
-- "Transferência entre Contas". Os lançamentos continuam visíveis na tabela
-- de transações para rastreabilidade; apenas não afetam o saldo líquido.

drop view if exists public.cash_transactions_with_balance;

create view public.cash_transactions_with_balance
with (security_invoker = true) as
select
  ct.*,
  sum(
    case
      when c.name = 'Transferência entre Contas' then 0
      when ct.type = 'entrada' then ct.amount
      else -ct.amount
    end
  ) over (order by ct.date, ct.created_at) as running_balance
from public.cash_transactions ct
left join public.cost_categories c on c.id = ct.category_id;

grant select on public.cash_transactions_with_balance to financeiro_app;
