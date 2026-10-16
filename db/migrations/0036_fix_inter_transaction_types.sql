-- Corrige o tipo (entrada/saída) das transações do Inter PJ que foram salvas
-- erroneamente como "entrada" quando deveriam ser "saida".
--
-- Causa raiz: inter.ts usava tipoTransacao.startsWith("D") para débito,
-- mas a API do Inter retorna títulos como "Pix enviado", "Pagamento DARF" etc.
-- Esses não começam com "D", então caíam no fallback rawValue < 0, que
-- também falha porque os valores da API Inter vêm sempre positivos.
-- Resultado: TODA transação Inter virava "entrada".
--
-- Correção: usa o campo description (que contém o título da transação do Inter)
-- para reclassificar. Palavras-chave de débito → saida; de crédito → entrada.
-- Somente transações source='inter' com type='entrada' são candidatas a correção.
-- A coluna de duplicata (dedupe_key) NÃO é alterada para não perder o histórico.

do $$
declare
  v_cat_id uuid;
begin
  -- 1. Corrige tipos: "PIX ENVIADO" / "PAGAMENTO" etc → saida
  update public.cash_transactions
  set type = 'saida'
  where source = 'inter'
    and type = 'entrada'
    and (
      description ilike '%pix enviado%'
      or description ilike '%pagamento darf%'
      or description ilike '%pagamento simples nacional%'
      or description ilike '%pagamento boleto%'
      or description ilike '%tarifa%'
      or description ilike '%transferencia enviada%'
      or description ilike '%ted enviado%'
      or description ilike '%doc enviado%'
    );

  -- 2. Remove categoria 'Transferência entre Contas' de transações que ficaram
  --    pareadas incorretamente por terem o tipo errado (serão re-pareadas abaixo).
  select id into v_cat_id
  from public.cost_categories
  where name = 'Transferência entre Contas'
  limit 1;

  if v_cat_id is not null then
    -- Limpa categorias em pares inválidos (ambos do mesmo tipo após correção)
    update public.cash_transactions
    set category_id = null
    where category_id = v_cat_id
      and source in ('asaas', 'inter', 'api_sync');

    -- Re-pareia transferências entre contas (idempotente)
    with pares as (
      select
        a.id as id_a,
        b.id as id_b,
        row_number() over (partition by a.id order by abs(a.amount - b.amount)) as rn_a,
        row_number() over (partition by b.id order by abs(a.amount - b.amount)) as rn_b
      from public.cash_transactions a
      join public.cash_transactions b
        on  a.date   = b.date
        and a.type  <> b.type
        and a.source <> b.source
        and a.source  in ('asaas', 'inter', 'api_sync')
        and b.source  in ('asaas', 'inter', 'api_sync')
        and abs(a.amount - b.amount) < 0.01
        and a.category_id is null
        and b.category_id is null
        and a.id < b.id
    ),
    ids as (
      select id_a as id from pares where rn_a = 1 and rn_b = 1
      union all
      select id_b         from pares where rn_a = 1 and rn_b = 1
    )
    update public.cash_transactions
    set category_id = v_cat_id
    where id in (select id from ids);
  end if;

end $$;
