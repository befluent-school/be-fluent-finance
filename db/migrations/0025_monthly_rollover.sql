-- Etapa 8: Motor de virada de mês/ano (rollover).
--
-- Uma única função SQL faz TODO o trabalho da virada, para que o script
-- agendado (scripts/rollover.mjs) e o botão "Rodar agora" (Server Action)
-- executem exatamente a mesma lógica — sem risco de divergir.
--
-- É IDEMPOTENTE: pode rodar várias vezes no mesmo dia/mês sem duplicar nada
-- (todas as inserções usam ON CONFLICT DO NOTHING sobre constraints únicas).
-- Pode rodar atrasada (ex.: máquina ficou desligada uma semana) e ainda assim
-- gera o que faltou de meses anteriores até o mês corrente.
--
-- O que faz, para o mês corrente e para quaisquer meses pendentes desde a
-- última execução:
--   1. Gera as mensalidades (invoices) de cada matrícula ativa no mês.
--   2. Gera as contas a pagar recorrentes (recurring_payables) do mês.
--   3. Gera o DAS do Simples da competência FECHADA (mês anterior), com
--      vencimento no dia configurado (padrão: dia 20 do mês seguinte).
--   4. Reavalia o status (pendente→atrasado) de invoices e payables vencidas.
--
-- "Pendentes/atrasados" não precisam ser "carregados" para o novo mês: eles
-- continuam existindo com seu reference_month original e aparecem nas telas
-- de A Receber / A Pagar enquanto não forem quitados. A virada apenas garante
-- que (a) o novo mês ganhe seus lançamentos e (b) o status de atraso esteja em
-- dia. Isso evita a duplicação que "reemitir no mês novo" causaria.

-- Roda como dono do banco (security definer) para poder escrever em invoices,
-- payables e job_runs independentemente do papel de quem chamou — mas só é
-- EXECUTÁVEL por quem recebeu grant (financeiro_app) e, no app, só a partir de
-- uma Server Action protegida por policy (owner/socio) ou do script do cron.
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
    if v_apur.das is not null and v_apur.das > 0 then
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
