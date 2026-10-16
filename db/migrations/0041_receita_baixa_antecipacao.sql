-- Receita bruta: desconta "Baixa da antecipação" do ASAAS.
-- Na antecipação o ASAAS credita o valor ("Antecipação") e, quando o cliente
-- paga, lança "Cobrança recebida" + "Baixa da antecipação" (negativa). Sem
-- descontar a baixa, a mesma mensalidade contava duas vezes.
-- Mesmas colunas da 0038: create or replace mantém v_simples_apuracao.

create or replace view public.v_receita_bruta_mensal
with (security_invoker = true) as
with corte as (
  select min(date) as data_corte from public.cash_transactions where source = 'opening'
),
calculada as (
  select
    date_trunc('month', ct.date)::date as reference_month,
    sum(case when ct.type = 'entrada' then ct.amount else -ct.amount end) as receita
  from public.cash_transactions ct
  left join public.cost_categories cc on cc.id = ct.category_id
  where ct.source <> 'opening'
    and coalesce(cc.name, '') not in ('Transferência entre Contas', 'Antecipação de Recebíveis', 'Não é Receita')
    and (
      (ct.type = 'entrada' and ct.description not ilike 'Estorno da taxa%')
      or (ct.type = 'saida' and (ct.description ilike 'Estorno - %' or ct.description ilike 'Baixa da antecipação%'))
    )
  group by 1
)
select
  coalesce(i.reference_month, c.reference_month) as reference_month,
  round(coalesce(c.receita, 0), 2) as receita_calculada,
  i.receita_bruta as receita_informada,
  coalesce(i.receita_bruta, greatest(round(coalesce(c.receita, 0), 2), 0)) as receita_bruta,
  (
    i.receita_bruta is not null
    or (select data_corte from corte) is null
    or coalesce(i.reference_month, c.reference_month) >= (select data_corte from corte)
  ) as coberto
from calculada c
full join public.simples_receita_informada i on i.reference_month = c.reference_month;

-- Pareamentos antigos (0033/0035/0036) aceitavam qualquer valor/data igual em
-- contas diferentes. Transferência real cita a empresa nas duas pernas; o que
-- não cita volta a ser lançamento comum (mensalidade, pagamento).
update public.cash_transactions ct
   set category_id = null
  from public.cost_categories cc
 where cc.id = ct.category_id
   and cc.name = 'Transferência entre Contas'
   and ct.source in ('asaas', 'inter', 'api_sync')
   and ct.description not ilike '%BE FLUENT IDIOMAS E ENSINO%';
