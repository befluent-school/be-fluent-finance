-- Etapa 4: Metas de faturamento e de alunos por mês de referência.
-- Substitui a aba "META FATURAMENTO" (praticamente vazia na planilha) por
-- uma tabela real, editável mês a mês.

create table public.revenue_targets (
  id uuid primary key default gen_random_uuid(),
  reference_month date not null unique, -- sempre dia 1 do mês
  target_amount numeric(10, 2) not null check (target_amount >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.student_targets (
  id uuid primary key default gen_random_uuid(),
  reference_month date not null,
  plan_id uuid references public.plans (id),
  target_count integer not null check (target_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (reference_month, plan_id)
);

create trigger trg_revenue_targets_updated_at before update on public.revenue_targets
  for each row execute function public.set_updated_at();
create trigger trg_student_targets_updated_at before update on public.student_targets
  for each row execute function public.set_updated_at();

alter table public.revenue_targets enable row level security;
alter table public.student_targets enable row level security;

create policy "revenue_targets_select_authenticated"
  on public.revenue_targets for select
  using (auth.role() = 'authenticated');

create policy "revenue_targets_write_owner_or_socio"
  on public.revenue_targets for all
  using (public.current_role_name() in ('owner', 'socio'))
  with check (public.current_role_name() in ('owner', 'socio'));

create policy "student_targets_select_authenticated"
  on public.student_targets for select
  using (auth.role() = 'authenticated');

create policy "student_targets_write_owner_or_socio"
  on public.student_targets for all
  using (public.current_role_name() in ('owner', 'socio'))
  with check (public.current_role_name() in ('owner', 'socio'));
