-- Etapa 4: Views de indicadores executivos.
-- Nunca gravar CAC/LTV/MRR como coluna — sempre recalcular a partir dos
-- dados transacionais, para nunca dessincronizar (mesmo princípio já usado
-- no saldo de caixa e no status efetivo de fatura).

-- MRR: soma das mensalidades de matrículas ativas.
create view public.v_mrr
with (security_invoker = true) as
select coalesce(sum(monthly_value), 0) as mrr
from public.enrollments
where status = 'active';

-- Ticket médio geral e por plano, considerando só matrículas ativas.
create view public.v_ticket_medio_por_plano
with (security_invoker = true) as
select
  p.id as plan_id,
  p.name as plan_name,
  count(e.id) as active_students,
  coalesce(avg(e.monthly_value), 0) as ticket_medio,
  coalesce(sum(p.monthly_value * p.avg_duration_months), 0) / nullif(count(e.id), 0) as ltv_medio
from public.plans p
left join public.enrollments e on e.plan_id = p.id and e.status = 'active'
group by p.id, p.name;

-- CAC do mês: custos de marketing lançados no caixa dividido pelo nº de
-- matrículas novas no mesmo mês (proxy de "novos clientes").
create view public.v_cac_by_month
with (security_invoker = true) as
with marketing_spend as (
  select date_trunc('month', ct.date)::date as reference_month, sum(ct.amount) as spend
  from public.cash_transactions ct
  join public.cost_categories cc on cc.id = ct.category_id
  where cc.name = 'Marketing e Vendas' and ct.type = 'saida'
  group by date_trunc('month', ct.date)
),
new_students as (
  select date_trunc('month', e.start_date)::date as reference_month, count(*) as students
  from public.enrollments e
  group by date_trunc('month', e.start_date)
)
select
  ms.reference_month,
  ms.spend as marketing_spend,
  coalesce(ns.students, 0) as new_students,
  case when coalesce(ns.students, 0) > 0 then ms.spend / ns.students else null end as cac
from marketing_spend ms
left join new_students ns on ns.reference_month = ms.reference_month;

-- Inadimplência do mês corrente: total em atraso "de verdade" (vencimento
-- passado e ainda não pago), usando o mesmo cálculo da view de status efetivo.
create view public.v_inadimplencia_atual
with (security_invoker = true) as
select
  coalesce(sum(amount), 0) as total_atrasado,
  count(*) as faturas_atrasadas
from public.invoices_with_effective_status
where effective_status = 'atrasado';
