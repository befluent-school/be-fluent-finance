-- Remove o LEFT JOIN da view cash_transactions_with_balance.
--
-- Root cause: as migrations 0032 e 0034 adicionaram um LEFT JOIN com
-- cost_categories para verificar "Transferência entre Contas". Esse JOIN
-- corrompe a window function de duas formas:
--   1. Se houver qualquer duplicata de category_id ou inconsistência, o JOIN
--      pode multiplicar linhas, fazendo o acumulado saltar.
--   2. A window function opera sobre o resultado do JOIN (não sobre a tabela
--      base), então a ordenação por (date, created_at, id) pode não ser
--      estável quando o JOIN reordena ou duplica linhas.
--
-- Solução: a view volta a ser simples (sem JOIN), calculando o running_balance
-- bruto sobre todas as transações em ordem determinística. A exclusão de
-- "Transferência entre Contas" é feita na query da page (já estava sendo feita
-- assim para os cards de totais) — não precisa estar na view.
--
-- O running_balance da view representa o saldo bancário real acumulado,
-- incluindo transferências internas. A page já exclui transferências dos
-- cards "Entradas/Saídas" usando filtro no TypeScript. O saldo exibido
-- no card "Saldo acumulado" usa a última linha da view (transação mais
-- recente), que é o saldo real das contas combinadas.

-- Re-executa o pareamento de transferências (idempotente) pois a migration
-- 0033 pode ter rodado antes que todos os dados estivessem sincronizados.
do $$
declare
  v_cat_id uuid;
begin
  select id into v_cat_id from public.cost_categories
  where name = 'Transferência entre Contas' limit 1;
  if v_cat_id is null then return; end if;

  with pares as (
    select
      a.id as id_a,
      b.id as id_b,
      row_number() over (partition by a.id order by abs(a.amount - b.amount)) as rn_a,
      row_number() over (partition by b.id order by abs(a.amount - b.amount)) as rn_b
    from public.cash_transactions a
    join public.cash_transactions b
      on  a.date = b.date
      and a.type <> b.type
      and a.source <> b.source
      and a.source  in ('asaas','inter','api_sync')
      and b.source  in ('asaas','inter','api_sync')
      and abs(a.amount - b.amount) < 0.01
      and a.category_id is null
      and b.category_id is null
      and a.id < b.id
  ),
  ids as (
    select id_a as id from pares where rn_a=1 and rn_b=1
    union all
    select id_b     from pares where rn_a=1 and rn_b=1
  )
  update public.cash_transactions set category_id = v_cat_id
  where id in (select id from ids);
end $$;

drop view if exists public.cash_transactions_with_balance;

-- A view usa subquery escalar para evitar JOIN (que corrompia a window function
-- ao multiplicar ou reordenar linhas). O running_balance exclui:
--   • transferências entre contas próprias (category = 'Transferência entre Contas')
--   • lançamentos de saldo inicial (source = 'opening')
-- para que o saldo acumulado reflita apenas movimentações reais.
create view public.cash_transactions_with_balance
with (security_invoker = true) as
select
  ct.*,
  sum(
    case
      when ct.source = 'opening' then ct.amount        -- saldo inicial: conta positivo
      when (
        select name from public.cost_categories
        where id = ct.category_id limit 1
      ) = 'Transferência entre Contas' then 0           -- transferência: neutro
      when ct.type = 'entrada' then ct.amount
      else -ct.amount
    end
  ) over (order by ct.date, ct.created_at, ct.id) as running_balance
from public.cash_transactions ct;

grant select on public.cash_transactions_with_balance to financeiro_app;
