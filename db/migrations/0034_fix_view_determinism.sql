-- Corrige o saldo acumulado que ficava "preso" (igual para várias linhas
-- consecutivas) quando transações no mesmo dia tinham o mesmo created_at.
--
-- Causa: a window function "order by date, created_at" não é determinística
-- quando há empates em ambas as colunas — o banco agrupava essas linhas e
-- calculava o saldo de forma imprevisível dentro do grupo.
--
-- Solução: adicionar ct.id (uuid) como terceiro critério de desempate,
-- garantindo ordenação estável e saldo correto em toda situação.

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
  ) over (order by ct.date, ct.created_at, ct.id) as running_balance
from public.cash_transactions ct
left join public.cost_categories c on c.id = ct.category_id;

grant select on public.cash_transactions_with_balance to financeiro_app;
