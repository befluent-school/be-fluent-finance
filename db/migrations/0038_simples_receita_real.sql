-- Simples Nacional com base real.
--
-- Problemas corrigidos:
-- 1. Saldo inicial (source='opening') entrava como receita bruta.
-- 2. Estornos de cobrança e estornos de taxa entravam como receita.
-- 3. RBT12 era projetado (média dos meses × 12) para qualquer empresa com
--    menos de 12 meses DE DADOS no sistema — a regra de proporcionalização só
--    vale para empresa com menos de 12 meses DE ATIVIDADE (company_start_month).
-- 4. Meses parcialmente cobertos pelos dados bancários (ex.: setembro, com
--    saldo inicial em 15/09) eram tratados como completos.
--
-- A receita declarada no PGDAS (informada pela contabilidade) passa a ter
-- prioridade sobre a calculada. O DAS automático só é gerado quando a receita
-- do mês e os 12 meses anteriores estão completos.

create table public.simples_receita_informada (
  reference_month date primary key check (extract(day from reference_month) = 1),
  receita_bruta numeric(14, 2) not null check (receita_bruta >= 0),
  updated_at timestamptz not null default now()
);

create trigger trg_simples_receita_informada_updated_at before update on public.simples_receita_informada
  for each row execute function public.set_updated_at();
create trigger trg_simples_receita_informada_audit
  after insert or update or delete on public.simples_receita_informada
  for each row execute function app.audit_row_change();

alter table public.simples_receita_informada enable row level security;
create policy "simples_receita_informada_select_authenticated"
  on public.simples_receita_informada for select using (app.is_authenticated());
create policy "simples_receita_informada_write_owner_or_socio"
  on public.simples_receita_informada for all
  using (public.current_role_name() in ('owner', 'socio'))
  with check (public.current_role_name() in ('owner', 'socio'));
grant select, insert, update, delete on public.simples_receita_informada to financeiro_app;

-- Entradas que não são receita (devoluções, aportes, empréstimos) podem ser
-- marcadas com esta categoria no Fluxo de Caixa.
insert into public.cost_categories (name, type) values ('Não é Receita', 'variable')
on conflict (name) do nothing;

drop view if exists public.v_simples_apuracao;
drop view if exists public.v_receita_bruta_mensal;
drop function if exists public.simples_apuracao(date, text);

create view public.v_receita_bruta_mensal
with (security_invoker = true) as
with corte as (
  -- A partir do primeiro saldo inicial, os bancos conectados cobrem todo o
  -- movimento. Meses que começam antes disso estão incompletos.
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
      or (ct.type = 'saida' and ct.description ilike 'Estorno - %')
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

create or replace function public.simples_company_start()
returns date
language sql
stable
as $$
  select (value #>> '{}')::date from public.app_settings where key = 'company_start_month';
$$;

create or replace function public.simples_rbt12(p_apuracao date)
returns numeric
language plpgsql
stable
as $$
declare
  v_month date := date_trunc('month', p_apuracao)::date;
  v_start date := date_trunc('month', public.simples_company_start())::date;
  v_sum numeric;
  v_meses integer;
begin
  select coalesce(sum(receita_bruta), 0) into v_sum
  from public.v_receita_bruta_mensal
  where reference_month >= (v_month - interval '12 months')::date
    and reference_month < v_month;

  -- Proporcionalização (LC 123/2006, art. 18 §2º) só para empresa em início
  -- de atividade.
  if v_start is not null and v_start > (v_month - interval '12 months')::date then
    v_meses := (extract(year from age(v_month, v_start)) * 12 + extract(month from age(v_month, v_start)))::int;
    if v_meses <= 0 then
      select coalesce(sum(receita_bruta), 0) * 12 into v_sum
      from public.v_receita_bruta_mensal where reference_month = v_month;
      return v_sum;
    end if;
    return (v_sum / v_meses) * 12;
  end if;

  return v_sum;
end;
$$;

-- Quantos dos 12 meses anteriores ainda não têm receita completa (informada
-- ou totalmente coberta pelos bancos). Zero = RBT12 confiável.
create or replace function public.simples_meses_faltantes(p_apuracao date)
returns integer
language plpgsql
stable
as $$
declare
  v_month date := date_trunc('month', p_apuracao)::date;
  v_start date := date_trunc('month', public.simples_company_start())::date;
  v_desde date := (v_month - interval '12 months')::date;
  v_esperados integer := 12;
  v_cobertos integer;
begin
  if v_start is not null and v_start > v_desde then
    v_desde := v_start;
    v_esperados := greatest((extract(year from age(v_month, v_start)) * 12 + extract(month from age(v_month, v_start)))::int, 0);
  end if;

  select count(*) into v_cobertos
  from public.v_receita_bruta_mensal
  where reference_month >= v_desde and reference_month < v_month and coberto;

  return greatest(v_esperados - v_cobertos, 0);
end;
$$;

create function public.simples_apuracao(p_apuracao date, p_anexo text default null)
returns table (
  reference_month date,
  anexo text,
  rbt12 numeric,
  faixa integer,
  nominal_rate numeric,
  deduction numeric,
  effective_rate numeric,
  receita_mes numeric,
  das numeric,
  meses_faltantes integer,
  receita_completa boolean
)
language plpgsql
stable
as $$
declare
  v_month date := date_trunc('month', p_apuracao)::date;
  v_anexo text := coalesce(p_anexo, (select value #>> '{}' from public.app_settings where key = 'simples_anexo'), 'III');
  v_rbt12 numeric := public.simples_rbt12(v_month);
  v_faltantes integer := public.simples_meses_faltantes(v_month);
  v_receita numeric;
  v_completa boolean;
  v_bracket record;
  v_eff numeric;
begin
  select coalesce(sum(vr.receita_bruta), 0), coalesce(bool_and(vr.coberto), false)
    into v_receita, v_completa
  from public.v_receita_bruta_mensal vr
  where vr.reference_month = v_month;

  select * into v_bracket
  from public.simples_brackets b
  where b.anexo = v_anexo
    and v_rbt12 >= b.rbt12_min
    and (v_rbt12 <= b.rbt12_max or b.faixa = 6)
  order by b.faixa
  limit 1;

  if v_bracket is null then
    return query select v_month, v_anexo, v_rbt12, null::integer, null::numeric,
                        null::numeric, 0::numeric, v_receita, 0::numeric, v_faltantes, v_completa;
    return;
  end if;

  if v_rbt12 > 0 then
    v_eff := (v_rbt12 * v_bracket.nominal_rate - v_bracket.deduction) / v_rbt12;
  else
    v_eff := v_bracket.nominal_rate;
  end if;
  if v_eff < 0 then v_eff := 0; end if;

  return query select
    v_month, v_anexo, round(v_rbt12, 2), v_bracket.faixa, v_bracket.nominal_rate,
    v_bracket.deduction, round(v_eff, 6), round(v_receita, 2), round(v_receita * v_eff, 2),
    v_faltantes, v_completa;
end;
$$;

create view public.v_simples_apuracao
with (security_invoker = true) as
select a.*
from public.v_receita_bruta_mensal r
cross join lateral public.simples_apuracao(r.reference_month) a;

grant select on public.v_receita_bruta_mensal, public.v_simples_apuracao to financeiro_app;
grant execute on function public.simples_apuracao(date, text) to financeiro_app;
grant execute on function public.simples_rbt12(date) to financeiro_app;
grant execute on function public.simples_meses_faltantes(date) to financeiro_app;
grant execute on function public.simples_company_start() to financeiro_app;

-- DAS automáticos ainda não pagos: recalcula com a base corrigida; remove os
-- que não têm base completa (serão gerados pela virada quando tiverem).
do $$
declare
  r record;
  a record;
begin
  for r in select id, reference_month from public.payables where origin = 'das' and paid_date is null loop
    select * into a from public.simples_apuracao(r.reference_month);
    if a.meses_faltantes > 0 or not a.receita_completa or coalesce(a.das, 0) <= 0 then
      delete from public.payables where id = r.id;
    else
      update public.payables set amount = a.das where id = r.id;
    end if;
  end loop;
end $$;

-- Virada: só gera o DAS quando a receita do mês e o RBT12 estão completos.
create or replace function public.run_monthly_rollover(
  p_trigger text default 'manual',
  p_today date default current_date
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_enabled boolean;
  v_run_id uuid;
  v_current_month date := date_trunc('month', p_today)::date;
  v_invoice_day integer;
  v_das_day integer;
  v_anexo text;
  v_first_open date;      -- primeiro mês que ainda precisa ser processado
  v_m date;
  v_invoices_created integer := 0;
  v_payables_created integer := 0;
  v_das_created integer := 0;
  v_statuses_fixed integer := 0;
  v_n integer;
  v_das_comp date;
  v_apur record;
  v_das_due date;
  v_cat_impostos uuid;
begin
  select coalesce((value)::boolean, true) into v_enabled
  from public.app_settings where key = 'rollover_enabled';
  if v_enabled is false then
    return jsonb_build_object('skipped', true, 'reason', 'rollover_disabled');
  end if;

  select coalesce((value)::integer, 1)  into v_invoice_day from public.app_settings where key = 'invoice_generation_day';
  select coalesce((value)::integer, 20) into v_das_day     from public.app_settings where key = 'das_due_day';
  select coalesce(value #>> '{}', 'III') into v_anexo      from public.app_settings where key = 'simples_anexo';

  insert into public.job_runs (job, reference_month, trigger, status)
  values ('monthly_rollover', v_current_month, p_trigger, 'running')
  returning id into v_run_id;

  -- Determina o primeiro mês em aberto. Processa do mês da última virada
  -- bem-sucedida (exclusive) até o mês corrente (inclusive). Se nunca rodou,
  -- processa só o mês corrente (não reconstrói o passado inteiro — isso seria
  -- feito uma vez, manualmente, se desejado).
  select date_trunc('month', max(reference_month))::date
    into v_first_open
  from public.job_runs
  where job = 'monthly_rollover' and status = 'success';

  if v_first_open is null then
    v_first_open := v_current_month;
  else
    v_first_open := (v_first_open + interval '1 month')::date;
    if v_first_open > v_current_month then
      v_first_open := v_current_month;
    end if;
  end if;

  -- Categoria de impostos (para a payable do DAS).
  select id into v_cat_impostos from public.cost_categories where name = 'Impostos' limit 1;

  -- Loop pelos meses pendentes (normalmente só o mês corrente).
  v_m := v_first_open;
  while v_m <= v_current_month loop
    -- 1) Mensalidades do mês para matrículas ativas ------------------------
    with ins as (
      insert into public.invoices (enrollment_id, reference_month, amount, due_date)
      select
        e.id,
        v_m,
        e.monthly_value,
        make_date(
          extract(year from v_m)::int,
          extract(month from v_m)::int,
          least(e.due_day, extract(day from (date_trunc('month', v_m) + interval '1 month - 1 day'))::int)
        )
      from public.enrollments e
      where e.status = 'active'
        and e.start_date <= (date_trunc('month', v_m) + interval '1 month - 1 day')::date
        and (e.end_date is null or e.end_date >= v_m)
      on conflict (enrollment_id, reference_month) do nothing
      returning 1
    )
    select count(*) into v_n from ins;
    v_invoices_created := v_invoices_created + v_n;

    -- 2) Contas a pagar recorrentes do mês ---------------------------------
    with ins as (
      insert into public.payables
        (description, category_id, reference_month, amount, due_date, origin, recurring_template_id)
      select
        rp.description,
        rp.category_id,
        v_m,
        rp.amount,
        make_date(
          extract(year from v_m)::int,
          extract(month from v_m)::int,
          least(rp.due_day, extract(day from (date_trunc('month', v_m) + interval '1 month - 1 day'))::int)
        ),
        'recurring',
        rp.id
      from public.recurring_payables rp
      where rp.active
        and rp.start_month <= v_m
        and (rp.end_month is null or rp.end_month >= v_m)
      on conflict (recurring_template_id, reference_month)
        where recurring_template_id is not null
        do nothing
      returning 1
    )
    select count(*) into v_n from ins;
    v_payables_created := v_payables_created + v_n;

    v_m := (v_m + interval '1 month')::date;
  end loop;

  -- 3) DAS do Simples da competência FECHADA (mês anterior ao corrente) -----
  -- Só cria quando houve receita na competência (não gera DAS de mês zerado).
  if v_anexo in ('III', 'V') then
    v_das_comp := (v_current_month - interval '1 month')::date;
    select * into v_apur from public.simples_apuracao(v_das_comp, v_anexo);
    if v_apur.das is not null and v_apur.das > 0 and v_apur.meses_faltantes = 0 and v_apur.receita_completa then
      v_das_due := make_date(
        extract(year from v_current_month)::int,
        extract(month from v_current_month)::int,
        least(v_das_day, 28)
      );
      with ins as (
        insert into public.payables
          (description, category_id, reference_month, amount, due_date, origin, notes)
        values (
          'DAS Simples Nacional — competência ' || to_char(v_das_comp, 'MM/YYYY'),
          v_cat_impostos,
          v_das_comp,
          v_apur.das,
          v_das_due,
          'das',
          'Gerado automaticamente. Alíquota efetiva '
            || to_char(round(v_apur.effective_rate * 100, 2), 'FM999990.00') || '% sobre receita de '
            || to_char(v_apur.receita_mes, 'FM999G999G990D00') || ' (RBT12 '
            || to_char(v_apur.rbt12, 'FM999G999G990D00') || ', faixa ' || coalesce(v_apur.faixa::text, '—') || ').'
        )
        on conflict do nothing
        returning 1
      )
      select count(*) into v_n from ins;
      -- Evita duplicar DAS da mesma competência em execuções repetidas:
      -- se já existe uma payable origin='das' para a competência, não conta.
      if exists (
        select 1 from public.payables
        where origin = 'das' and reference_month = v_das_comp
        group by reference_month having count(*) > 1
      ) then
        -- apaga o excedente recém-criado (mantém o mais antigo)
        delete from public.payables p
        using (
          select id from public.payables
          where origin = 'das' and reference_month = v_das_comp
          order by created_at
          offset 1
        ) dup
        where p.id = dup.id;
        v_n := 0;
      end if;
      v_das_created := v_das_created + v_n;
    end if;
  end if;

  -- 4) Reavalia status de vencidos (toca a linha para o trigger recalcular) -
  with upd as (
    update public.invoices
      set updated_at = now()
    where paid_date is null and status <> 'atrasado' and due_date < p_today
    returning 1
  )
  select count(*) into v_n from upd;
  v_statuses_fixed := v_statuses_fixed + v_n;

  with upd as (
    update public.payables
      set updated_at = now()
    where paid_date is null and status <> 'atrasado' and due_date < p_today
    returning 1
  )
  select count(*) into v_n from upd;
  v_statuses_fixed := v_statuses_fixed + v_n;

  update public.job_runs
    set status = 'success',
        finished_at = now(),
        result = jsonb_build_object(
          'invoices_created', v_invoices_created,
          'payables_created', v_payables_created,
          'das_created', v_das_created,
          'statuses_fixed', v_statuses_fixed,
          'from_month', v_first_open,
          'to_month', v_current_month
        )
  where id = v_run_id;

  return jsonb_build_object(
    'ok', true,
    'run_id', v_run_id,
    'invoices_created', v_invoices_created,
    'payables_created', v_payables_created,
    'das_created', v_das_created,
    'statuses_fixed', v_statuses_fixed
  );
exception when others then
  update public.job_runs
    set status = 'error', finished_at = now(), error = sqlerrm
  where id = v_run_id;
  raise;
end;
$$;

-- O dono do banco é quem executa o corpo (security definer). Concede execução
-- ao papel da aplicação e ao papel dono (para o script do cron).
grant execute on function public.run_monthly_rollover(text, date) to financeiro_app;
