-- Metas adicionais de aquisição: CAC máximo aceitável e razão LTV:CAC mínima
-- desejada, por mês de referência. Mesmo padrão de revenue_targets/student_targets.

create table public.cac_targets (
  id uuid primary key default gen_random_uuid(),
  reference_month date not null unique, -- sempre dia 1 do mês
  max_cac numeric(10, 2) not null check (max_cac >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.ltv_cac_targets (
  id uuid primary key default gen_random_uuid(),
  reference_month date not null unique,
  min_ratio numeric(6, 2) not null check (min_ratio >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_cac_targets_updated_at before update on public.cac_targets
  for each row execute function public.set_updated_at();
create trigger trg_ltv_cac_targets_updated_at before update on public.ltv_cac_targets
  for each row execute function public.set_updated_at();

alter table public.cac_targets enable row level security;
alter table public.ltv_cac_targets enable row level security;

create policy "cac_targets_select_authenticated"
  on public.cac_targets for select
  using (auth.role() = 'authenticated');

create policy "cac_targets_write_owner_or_socio"
  on public.cac_targets for all
  using (public.current_role_name() in ('owner', 'socio'))
  with check (public.current_role_name() in ('owner', 'socio'));

create policy "ltv_cac_targets_select_authenticated"
  on public.ltv_cac_targets for select
  using (auth.role() = 'authenticated');

create policy "ltv_cac_targets_write_owner_or_socio"
  on public.ltv_cac_targets for all
  using (public.current_role_name() in ('owner', 'socio'))
  with check (public.current_role_name() in ('owner', 'socio'));
