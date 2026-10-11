-- Convertida do Supabase (20260101000006): auth.role() = 'authenticated' → app.is_authenticated().

-- RLS: plans, teachers, students, enrollments, invoices.
-- Todo usuário autenticado (owner/socio/funcionario) pode ler e operar o dia a dia
-- de alunos e mensalidades. Escrita de planos/professores fica restrita a
-- quem tem a permissão 'manage_invoices' (funcionário de operação) ou é owner/socio.

alter table public.plans enable row level security;
alter table public.teachers enable row level security;
alter table public.students enable row level security;
alter table public.enrollments enable row level security;
alter table public.invoices enable row level security;

create policy "plans_select_authenticated"
  on public.plans for select
  using (app.is_authenticated());

create policy "plans_write_owner_or_socio"
  on public.plans for all
  using (public.current_role_name() in ('owner', 'socio'))
  with check (public.current_role_name() in ('owner', 'socio'));

create policy "teachers_select_authenticated"
  on public.teachers for select
  using (app.is_authenticated());

create policy "teachers_write_owner_or_socio"
  on public.teachers for all
  using (public.current_role_name() in ('owner', 'socio'))
  with check (public.current_role_name() in ('owner', 'socio'));

create policy "students_select_authenticated"
  on public.students for select
  using (app.is_authenticated());

create policy "students_write_with_permission"
  on public.students for all
  using (public.has_permission('manage_invoices'))
  with check (public.has_permission('manage_invoices'));

create policy "enrollments_select_authenticated"
  on public.enrollments for select
  using (app.is_authenticated());

create policy "enrollments_write_with_permission"
  on public.enrollments for all
  using (public.has_permission('manage_invoices'))
  with check (public.has_permission('manage_invoices'));

create policy "invoices_select_authenticated"
  on public.invoices for select
  using (app.is_authenticated());

create policy "invoices_write_with_permission"
  on public.invoices for all
  using (public.has_permission('manage_invoices'))
  with check (public.has_permission('manage_invoices'));
