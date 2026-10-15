-- Corrige transferências históricas e adiciona suporte a saldo inicial por conta.
--
-- 1. Pareia as transferências ASAAS↔Inter já existentes no banco (que não foram
--    detectadas durante o sync porque a detecção dependia de ordem de inserção).
--
-- 2. Adiciona coluna `opening_balance` em bank_providers para registrar o saldo
--    da conta na data de início do histórico importado.
--
-- 3. A "transação de abertura" (fonte = 'opening') é inserida com a data do
--    primeiro extrato importado e categoria nula, para que o running_balance
--    parta do saldo real em vez de zero.

-- ── 1. Parear transferências históricas ─────────────────────────────────────

-- Encontra pares: saída ASAAS + entrada Inter (ou vice-versa) de mesmo valor
-- (±0.01) e mesma data, ambas sem categoria, e marca como "Transferência entre Contas".
-- Usa um CTE para garantir que cada transação seja usada em no máximo um par.

do $$
declare
  v_transfer_cat_id uuid;
begin
  select id into v_transfer_cat_id
    from public.cost_categories
    where name = 'Transferência entre Contas'
    limit 1;

  if v_transfer_cat_id is null then
    return; -- categoria ainda não existe, nada a fazer
  end if;

  -- Actualiza em pares: para cada par (a, b) com tipo oposto, mesma data,
  -- valor próximo e fontes diferentes (asaas ≠ inter), marca ambos.
  with pares as (
    select
      a.id as id_a,
      b.id as id_b,
      row_number() over (
        partition by a.id
        order by abs(a.amount - b.amount)
      ) as rn_a,
      row_number() over (
        partition by b.id
        order by abs(a.amount - b.amount)
      ) as rn_b
    from public.cash_transactions a
    join public.cash_transactions b
      on  a.date = b.date
      and a.type <> b.type
      and a.source <> b.source
      and a.source in ('asaas', 'inter', 'api_sync')
      and b.source in ('asaas', 'inter', 'api_sync')
      and abs(a.amount - b.amount) < 0.01
      and a.category_id is null
      and b.category_id is null
      and a.id < b.id  -- evita duplicatas (a,b) e (b,a)
  ),
  ids_para_atualizar as (
    select id_a as id from pares where rn_a = 1 and rn_b = 1
    union all
    select id_b as id from pares where rn_a = 1 and rn_b = 1
  )
  update public.cash_transactions
     set category_id = v_transfer_cat_id
   where id in (select id from ids_para_atualizar);

end $$;

-- ── 2. Coluna opening_balance em bank_providers ──────────────────────────────

alter table public.bank_providers
  add column if not exists opening_balance numeric(12, 2) default null,
  add column if not exists opening_balance_date date default null;

-- ── 3. Suporte a transações de abertura (source = 'opening') ─────────────────

alter table public.cash_transactions
  drop constraint if exists cash_transactions_source_check;

alter table public.cash_transactions
  add constraint cash_transactions_source_check
    check (source in ('manual', 'pluggy', 'asaas', 'inter', 'api_sync', 'opening', 'manual_import'));
