-- Saldo acumulado ancorado no saldo inicial de cada conta.
--
-- 1. O saldo inicial informado já contém todo o histórico anterior da conta,
--    então lançamentos da conta com data anterior ao saldo inicial ficam fora
--    da soma (antes eram somados de novo, inflando o saldo em ~R$ 5 mil).
--    Lançamentos sem conta (manuais/importados) ficam fora se anteriores ao
--    primeiro saldo inicial cadastrado.
-- 2. O saldo inicial é sempre o primeiro lançamento do seu dia (antes entrava
--    no meio do dia, pela ordem de created_at).
-- 3. Transferências entre contas não recebem tratamento especial: as duas
--    pernas (saída numa conta, entrada na outra) se anulam no saldo combinado.
-- 4. `seq` expõe a ordem exata do cálculo para a tela listar na mesma ordem.
-- 5. bank_balance guarda o saldo informado pela API do banco, para conferência.

alter table public.bank_providers
  add column if not exists bank_balance numeric(12, 2),
  add column if not exists bank_balance_at timestamptz;

drop view if exists public.cash_transactions_with_balance;

create view public.cash_transactions_with_balance
with (security_invoker = true) as
with aberturas as (
  select bank_provider_id, min(date) as data_abertura
  from public.cash_transactions
  where source = 'opening'
  group by bank_provider_id
),
corte_global as (
  select min(data_abertura) as data_corte from aberturas
),
base as (
  select
    ct.*,
    case
      when ct.source = 'opening' then true
      when a.data_abertura is not null then ct.date >= a.data_abertura
      when (select data_corte from corte_global) is not null
        then ct.date >= (select data_corte from corte_global)
      else true
    end as in_balance
  from public.cash_transactions ct
  left join aberturas a on a.bank_provider_id = ct.bank_provider_id
),
calc as (
  select
    b.*,
    sum(
      case
        when not b.in_balance then 0
        when b.type = 'entrada' then b.amount
        else -b.amount
      end
    ) over w as saldo,
    row_number() over w as seq
  from base b
  window w as (order by b.date, (b.source = 'opening') desc, b.created_at, b.id
               rows between unbounded preceding and current row)
)
select
  calc.*,
  case when calc.in_balance then calc.saldo end as running_balance
from calc;

grant select on public.cash_transactions_with_balance to financeiro_app;
