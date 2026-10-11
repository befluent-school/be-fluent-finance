-- Etapa 6: Contas a pagar, configurações da empresa e registro de automações.
--
-- Até aqui o sistema tinha "a receber" (invoices) e o que já aconteceu no
-- caixa (cash_transactions), mas não tinha CONTAS A PAGAR com vencimento e
-- status próprios — então custos fixos recorrentes (contador, pró-labore,
-- ferramentas, DAS do Simples) viviam só na cabeça do dono. Esta migration
-- cria esse domínio, mais uma tabela de configurações da empresa e um log
-- das execuções de automação (virada de mês/ano).

-- ── Configurações da empresa (chave/valor tipado) ──────────────────────────
-- Uma linha por parâmetro. Guardamos como jsonb para caber número, texto ou
-- objeto sem precisar de migration a cada novo ajuste (ex.: regime tributário,
-- dia de geração das mensalidades, mês de abertura da empresa).
create table public.app_settings (
  key text primary key,
  value jsonb not null,
  description text,
  updated_at timestamptz not null default now()
);

create trigger trg_app_settings_updated_at before update on public.app_settings
  for each row execute function public.set_updated_at();

-- ── Contas a pagar ─────────────────────────────────────────────────────────
-- Espelha a lógica de invoices (receber): reference_month = dia 1 do mês de
-- competência, status derivado de due_date/paid_date por trigger, e uma view
-- de status efetivo para nunca "vencer silenciosamente".
--
-- origin distingue de onde a conta nasceu:
--   manual     — lançada à mão
--   recurring  — gerada pela automação a partir de um template recorrente
--   das        — DAS do Simples Nacional gerado pela automação
--   teacher    — repasse de professor (futuro)
create table public.payables (
  id uuid primary key default gen_random_uuid(),
  description text not null,
  category_id uuid references public.cost_categories (id),
  reference_month date not null, -- sempre dia 1 do mês de competência
  amount numeric(12, 2) not null check (amount >= 0),
  due_date date not null,
  paid_date date,
  payment_method text check (payment_method in ('pix', 'cartao', 'boleto', 'transferencia')),
  status text not null default 'pendente' check (status in ('pago', 'atrasado', 'pendente')),
  origin text not null default 'manual' check (origin in ('manual', 'recurring', 'das', 'teacher')),
  recurring_template_id uuid, -- FK adicionada depois que a tabela de templates existe
  cash_transaction_id uuid references public.cash_transactions (id) on delete set null,
  total_paid numeric(12, 2),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_payables_reference_month on public.payables (reference_month);
create index idx_payables_status on public.payables (status);
create index idx_payables_due_date on public.payables (due_date);
create index idx_payables_category on public.payables (category_id);

create trigger trg_payables_updated_at before update on public.payables
  for each row execute function public.set_updated_at();

-- Mesmo trigger de status das invoices: pago > atrasado (venceu) > pendente.
create or replace function public.set_payable_status()
returns trigger
language plpgsql
as $$
begin
  if new.paid_date is not null then
    new.status = 'pago';
  elsif new.due_date < current_date then
    new.status = 'atrasado';
  else
    new.status = 'pendente';
  end if;
  return new;
end;
$$;

create trigger trg_payables_set_status
  before insert or update on public.payables
  for each row execute function public.set_payable_status();

-- Status efetivo calculado na consulta (não depende de a linha ser regravada).
create view public.payables_with_effective_status
with (security_invoker = true) as
select
  p.*,
  case
    when p.paid_date is not null then 'pago'
    when p.due_date < current_date then 'atrasado'
    else 'pendente'
  end as effective_status
from public.payables p;

-- ── Templates de contas recorrentes ────────────────────────────────────────
-- Custos fixos que se repetem todo mês (contador, pró-labore, SaaS, aluguel).
-- A automação de virada de mês cria uma payable por template ativo, no dia
-- de vencimento configurado. due_day 1..28 (igual às matrículas) para nunca
-- cair em mês sem o dia 29/30/31.
create table public.recurring_payables (
  id uuid primary key default gen_random_uuid(),
  description text not null,
  category_id uuid references public.cost_categories (id),
  amount numeric(12, 2) not null check (amount >= 0),
  due_day integer not null check (due_day between 1 and 28),
  active boolean not null default true,
  start_month date not null default date_trunc('month', current_date)::date,
  end_month date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_recurring_payables_updated_at before update on public.recurring_payables
  for each row execute function public.set_updated_at();

alter table public.payables
  add constraint payables_recurring_template_fk
  foreign key (recurring_template_id) references public.recurring_payables (id) on delete set null;

-- Uma payable recorrente por (template, mês de competência): a automação é
-- idempotente — rodar duas vezes no mesmo mês não duplica.
create unique index uq_payables_recurring_month
  on public.payables (recurring_template_id, reference_month)
  where recurring_template_id is not null;

-- ── Log de execuções de automação ──────────────────────────────────────────
-- Cada execução da virada (manual ou agendada) grava uma linha: o que foi
-- criado, quando, e se deu erro. Alimenta o painel "Automação" e serve de
-- trava de idempotência por período quando necessário.
create table public.job_runs (
  id uuid primary key default gen_random_uuid(),
  job text not null,                 -- 'monthly_rollover'
  reference_month date,              -- competência processada
  trigger text not null default 'manual' check (trigger in ('manual', 'scheduled', 'startup')),
  status text not null default 'running' check (status in ('running', 'success', 'error')),
  result jsonb,                      -- contadores do que foi gerado
  error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create index idx_job_runs_job_started on public.job_runs (job, started_at desc);

-- ── RLS ────────────────────────────────────────────────────────────────────
alter table public.app_settings enable row level security;
alter table public.payables enable row level security;
alter table public.recurring_payables enable row level security;
alter table public.job_runs enable row level security;

-- Configurações e contas a pagar: leitura para todo autenticado; escrita
-- restrita a owner/socio (são configuração/decisão financeira, não lançamento
-- operacional do dia a dia).
create policy "app_settings_select_authenticated"
  on public.app_settings for select using (app.is_authenticated());
create policy "app_settings_write_owner_or_socio"
  on public.app_settings for all
  using (public.current_role_name() in ('owner', 'socio'))
  with check (public.current_role_name() in ('owner', 'socio'));

create policy "payables_select_authenticated"
  on public.payables for select using (app.is_authenticated());
create policy "payables_write_owner_or_socio"
  on public.payables for all
  using (public.current_role_name() in ('owner', 'socio'))
  with check (public.current_role_name() in ('owner', 'socio'));

create policy "recurring_payables_select_authenticated"
  on public.recurring_payables for select using (app.is_authenticated());
create policy "recurring_payables_write_owner_or_socio"
  on public.recurring_payables for all
  using (public.current_role_name() in ('owner', 'socio'))
  with check (public.current_role_name() in ('owner', 'socio'));

-- job_runs: leitura para todo autenticado (painel de automação); escrita só
-- pela automação, que roda como owner/socio (ação manual) ou via script dono
-- do banco. Mantemos a escrita em owner/socio para a Server Action "Rodar agora".
create policy "job_runs_select_authenticated"
  on public.job_runs for select using (app.is_authenticated());
create policy "job_runs_write_owner_or_socio"
  on public.job_runs for all
  using (public.current_role_name() in ('owner', 'socio'))
  with check (public.current_role_name() in ('owner', 'socio'));

-- ── Auditoria automática das novas tabelas de dados ─────────────────────────
-- (job_runs fica de fora: é log técnico de alto volume, não dado de negócio.)
do $$
declare t text;
begin
  foreach t in array array['app_settings', 'payables', 'recurring_payables']
  loop
    execute format(
      'create trigger trg_%1$s_audit after insert or update or delete on public.%1$I
         for each row execute function app.audit_row_change()', t);
  end loop;
end;
$$;

-- ── Permissões do papel da aplicação nas novas tabelas ──────────────────────
-- 0021 concedeu "all tables in schema" uma vez; tabelas criadas depois dele
-- precisam de grant explícito.
grant select, insert, update, delete on
  public.app_settings, public.payables, public.recurring_payables, public.job_runs
  to financeiro_app;

-- ── Seed de configurações iniciais ─────────────────────────────────────────
insert into public.app_settings (key, value, description) values
  ('tax_regime', '"simples_nacional"'::jsonb, 'Regime tributário da empresa'),
  ('simples_anexo', '"III"'::jsonb, 'Anexo do Simples Nacional (serviços de ensino = Anexo III)'),
  ('invoice_generation_day', '1'::jsonb, 'Dia do mês em que as mensalidades do mês são geradas automaticamente'),
  ('das_due_day', '20'::jsonb, 'Dia de vencimento do DAS (padrão: dia 20 do mês seguinte à competência)'),
  ('company_start_month', 'null'::jsonb, 'Mês de abertura da empresa (YYYY-MM-01), usado quando ainda não há 12 meses de receita'),
  ('rollover_enabled', 'true'::jsonb, 'Liga/desliga a automação de virada de mês')
on conflict (key) do nothing;
