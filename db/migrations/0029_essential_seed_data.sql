-- Dados essenciais de configuração (produção).
--
-- Os arquivos de db/seeds/ só rodam em desenvolvimento (npm run db:seed é
-- bloqueado em produção). Em produção, portanto, as permissões por papel,
-- os planos e as categorias de custo/receita nunca eram criados — e sem
-- permissões NEM o owner conseguia operar (importar alunos, lançar
-- mensalidades, etc. davam "Você não tem permissão para esta operação").
--
-- Esta migration carrega apenas os dados ESSENCIAIS para o sistema funcionar,
-- de forma idempotente (ON CONFLICT DO NOTHING). Não inclui professores nem
-- metas (dados de negócio que o owner cadastra/edita na tela). Roda como dono
-- do banco, que é dono destas tabelas — o RLS não se aplica (sem FORCE RLS).

-- ── Permissões e atribuição por papel ──────────────────────────────────────
insert into public.permissions (code, description) values
  ('view_net_profit', 'Ver lucro líquido e DRE completo'),
  ('view_payroll', 'Ver folha de pagamento / valores pagos a professores'),
  ('view_bank_accounts', 'Ver dados de conexão bancária e saldos'),
  ('manage_users', 'Gerenciar usuários e papéis'),
  ('manage_invoices', 'Lançar e editar mensalidades'),
  ('manage_leads', 'Gerenciar CRM / pipeline de leads'),
  ('view_dashboards', 'Ver dashboards executivos e metas')
on conflict (code) do nothing;

-- owner: todas as permissões.
insert into public.role_permissions (role, permission_id)
select 'owner', id from public.permissions
on conflict do nothing;

-- socio: dashboards, CRM e operação de mensalidades.
insert into public.role_permissions (role, permission_id)
select 'socio', id from public.permissions
where code in ('view_dashboards', 'manage_leads', 'manage_invoices')
on conflict do nothing;

-- funcionario: operação de mensalidades e CRM.
insert into public.role_permissions (role, permission_id)
select 'funcionario', id from public.permissions
where code in ('manage_invoices', 'manage_leads')
on conflict do nothing;

-- ── Planos (rebranding vigente) ────────────────────────────────────────────
insert into public.plans (name, lessons_per_week, monthly_value, avg_duration_months) values
  ('Bronze', 1, 357.00, 12),
  ('Silver', 2, 697.00, 12),
  ('Gold', 3, 997.00, 12),
  ('Diamond', 4, 1367.00, 12),
  ('VIP', 5, 1697.00, 12)
on conflict (name) do nothing;

-- ── Categorias de custo (despesa) ──────────────────────────────────────────
insert into public.cost_categories (name, type) values
  ('Assessoria Contábil', 'fixed'),
  ('Impostos', 'variable'),
  ('Marketing e Vendas', 'variable'),
  ('Pagamento Professores', 'variable'),
  ('Sócio Administrativo (Pró-labore)', 'fixed'),
  ('Colaborador (Estagiário/Atendente)', 'fixed'),
  ('Design de Conteúdo', 'variable'),
  ('Edição de Conteúdo', 'variable'),
  ('Criação de Conteúdo', 'variable'),
  ('Criação de Apresentações', 'variable'),
  ('API para WhatsApp (Z-API)', 'fixed'),
  ('Fluxos de Automação (N8N)', 'fixed'),
  ('Jurídico', 'variable')
on conflict (name) do nothing;

-- ── Categorias de receita (entrada) + transferência entre contas ───────────
insert into public.cost_categories (name, type) values
  ('Mensalidade de Aluno', 'variable'),
  ('Antecipação de Recebíveis', 'variable'),
  ('Outras Receitas', 'variable'),
  ('Taxas Asaas', 'variable'),
  ('Transferência entre Contas', 'variable'),
  ('Outro', 'variable')
on conflict (name) do nothing;
