-- Convertida do Supabase (20260101000004) sem alterações de schema.

-- Etapa 2: Planos, professores, alunos, matrículas e mensalidades (invoices).
-- Substitui as 12 abas mensais "CONTROLE DE MENSALIDADES" da planilha por uma
-- única tabela de faturas, e as abas "LTV x CAC" por um cadastro real de planos.

create table public.plans (
  id uuid primary key default gen_random_uuid(),
  name text not null unique, -- Bronze, Silver, Gold, Diamond, VIP
  lessons_per_week integer not null check (lessons_per_week > 0),
  monthly_value numeric(10, 2) not null check (monthly_value >= 0),
  avg_duration_months integer not null check (avg_duration_months > 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.teachers (
  id uuid primary key default gen_random_uuid(),
  full_name text not null unique,
  -- Cada professor tem um modelo de pagamento diferente na Be Fluent
  -- (repasse por aula, hora fixa, comissão %) — texto livre em vez de
  -- enum, para não travar a lógica de negócio em um único formato.
  payment_rule_text text,
  payment_reference_value numeric(10, 2),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.students (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  payer_name text, -- responsável financeiro, quando diferente do aluno
  cpf text,
  phone text,
  email text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.enrollments (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students (id) on delete cascade,
  plan_id uuid not null references public.plans (id),
  teacher_id uuid references public.teachers (id),
  monthly_value numeric(10, 2) not null check (monthly_value >= 0),
  due_day integer not null check (due_day between 1 and 28),
  class_type text not null default 'individual' check (class_type in ('individual')),
  start_date date not null default current_date,
  end_date date,
  status text not null default 'active' check (status in ('active', 'paused', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_enrollments_student_id on public.enrollments (student_id);

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references public.enrollments (id) on delete cascade,
  reference_month date not null, -- sempre o dia 1 do mês de referência
  amount numeric(10, 2) not null check (amount >= 0),
  due_date date not null,
  paid_date date,
  payment_method text check (payment_method in ('pix', 'cartao', 'boleto', 'transferencia')),
  status text not null default 'pendente' check (status in ('pago', 'atrasado', 'pendente')),
  receipt_sent boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (enrollment_id, reference_month)
);

create index idx_invoices_enrollment_id on public.invoices (enrollment_id);
create index idx_invoices_reference_month on public.invoices (reference_month);
create index idx_invoices_status on public.invoices (status);

create trigger trg_plans_updated_at before update on public.plans
  for each row execute function public.set_updated_at();
create trigger trg_teachers_updated_at before update on public.teachers
  for each row execute function public.set_updated_at();
create trigger trg_students_updated_at before update on public.students
  for each row execute function public.set_updated_at();
create trigger trg_enrollments_updated_at before update on public.enrollments
  for each row execute function public.set_updated_at();
create trigger trg_invoices_updated_at before update on public.invoices
  for each row execute function public.set_updated_at();

-- Marca automaticamente como atrasada uma fatura pendente cujo vencimento passou,
-- e volta para pendente se a data de pagamento for removida antes do vencimento.
create or replace function public.set_invoice_status()
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

create trigger trg_invoices_set_status
  before insert or update on public.invoices
  for each row execute function public.set_invoice_status();
