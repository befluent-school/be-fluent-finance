-- Convertida do Supabase (20260101000014): auth.role() = 'authenticated' → app.is_authenticated().

-- Calendário de atividades + checklist de tarefas administrativas.
-- Recorrência simples: uma linha = uma ocorrência. Ao concluir uma tarefa
-- recorrente, a aplicação cria a próxima ocorrência (due_date + período).

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  due_date date not null,
  priority text not null default 'media' check (priority in ('alta', 'media', 'baixa')),
  assignee_id uuid references public.profiles (id) on delete set null,
  recurrence text not null default 'none' check (recurrence in ('none', 'daily', 'weekly', 'monthly')),
  completed boolean not null default false,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_tasks_due_date on public.tasks (due_date);
create index idx_tasks_completed on public.tasks (completed);

create trigger trg_tasks_updated_at before update on public.tasks
  for each row execute function public.set_updated_at();

alter table public.tasks enable row level security;

create policy "tasks_select_authenticated"
  on public.tasks for select
  using (app.is_authenticated());

create policy "tasks_write_authenticated"
  on public.tasks for all
  using (app.is_authenticated())
  with check (app.is_authenticated());
