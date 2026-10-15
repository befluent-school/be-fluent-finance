-- Etapa 10: Folha de pagamento de professores.
--
-- Cada professor tem uma REGRA de pagamento. A folha mensal calcula um valor
-- SUGERIDO pela regra e deixa o owner/sócio ajustar o valor final (faltas e
-- remarcações fazem o professor não dar todas as aulas). Ao confirmar, vira
-- uma conta a pagar (payables), integrando com o módulo financeiro.

-- ── Campos de regra de pagamento no cadastro de professores ─────────────────
-- payment_type:
--   por_hora         → valor_referencia = R$ por aula/hora dada
--   comissao         → valor_referencia = % da receita que o professor gera
--   repasse_integral → repassa 100% do que os alunos dele pagam
--   fixo             → valor_referencia = valor fixo mensal
--   outro            → sem cálculo automático (só valor manual na folha)
alter table public.teachers
  add column payment_type text not null default 'outro'
    check (payment_type in ('por_hora', 'comissao', 'repasse_integral', 'fixo', 'outro'));

-- Nome único (case-insensitive) ajuda a importação de alunos a casar o
-- professor sem ambiguidade. Já existe unique(full_name); reforçamos com índice
-- funcional para buscas por nome em minúsculas.
create index if not exists idx_teachers_lower_name on public.teachers (lower(full_name));

-- ── Folha mensal (um registro por professor por mês de competência) ─────────
create table public.teacher_payments (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.teachers (id) on delete cascade,
  reference_month date not null,            -- dia 1 do mês de competência
  lessons_given integer not null default 0 check (lessons_given >= 0),
  suggested_amount numeric(12, 2) not null default 0 check (suggested_amount >= 0),
  final_amount numeric(12, 2) not null default 0 check (final_amount >= 0),
  status text not null default 'aberto' check (status in ('aberto', 'confirmado')),
  payable_id uuid references public.payables (id) on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (teacher_id, reference_month)
);

create index idx_teacher_payments_month on public.teacher_payments (reference_month);
create index idx_teacher_payments_teacher on public.teacher_payments (teacher_id);

create trigger trg_teacher_payments_updated_at before update on public.teacher_payments
  for each row execute function public.set_updated_at();

-- ── RLS ────────────────────────────────────────────────────────────────────
-- Folha de professores é dado financeiro sensível (quanto cada um recebe):
-- restrito a owner/socio, igual a contas a pagar.
alter table public.teacher_payments enable row level security;

create policy "teacher_payments_select_owner_or_socio"
  on public.teacher_payments for select
  using (public.current_role_name() in ('owner', 'socio'));

create policy "teacher_payments_write_owner_or_socio"
  on public.teacher_payments for all
  using (public.current_role_name() in ('owner', 'socio'))
  with check (public.current_role_name() in ('owner', 'socio'));

-- ── Auditoria + grants ──────────────────────────────────────────────────────
create trigger trg_teacher_payments_audit
  after insert or update or delete on public.teacher_payments
  for each row execute function app.audit_row_change();

grant select, insert, update, delete on public.teacher_payments to financeiro_app;

-- ── Seed dos professores conhecidos (idempotente) ───────────────────────────
-- Em produção o seed de professores (db/seeds/0003) não roda; sem isto a
-- importação de alunos falha ("Professor X não encontrado"). Inclui os nomes
-- que aparecem na planilha de importação.
insert into public.teachers (full_name, payment_type, payment_reference_value, payment_rule_text) values
  ('Isabella', 'repasse_integral', null, 'Repasse integral por aula (100% do valor pago pelo aluno)'),
  ('Marianna', 'comissao', 58.33, 'Comissão de 58,33% sobre a receita gerada'),
  ('Bianca', 'por_hora', 35.00, 'R$ 35,00 por hora de aula'),
  ('Nilton', 'por_hora', 35.00, 'R$ 35,00 por hora de aula'),
  ('Anna Beatriz', 'por_hora', 35.00, 'R$ 35,00 por hora de aula (ajuste a regra conforme o combinado)')
on conflict (full_name) do nothing;

-- Classifica o tipo de pagamento de professores que já existiam antes desta
-- migration (o INSERT acima não os atualiza por causa do ON CONFLICT). Só
-- toca quem ainda está em 'outro', para não sobrescrever ajustes manuais.
update public.teachers set payment_type = 'repasse_integral'
  where lower(full_name) = 'isabella' and payment_type = 'outro';
update public.teachers set payment_type = 'comissao'
  where lower(full_name) = 'marianna' and payment_type = 'outro';
update public.teachers set payment_type = 'por_hora'
  where lower(full_name) in ('bianca', 'nilton') and payment_type = 'outro';
