-- Seed inicial de permissões e atribuição por papel.
-- owner: acesso total. socio: dashboards/DRE/metas, sem folha/banco.
-- funcionario: operacional, sem dados financeiros sensíveis.

insert into public.permissions (code, description) values
  ('view_net_profit', 'Ver lucro líquido e DRE completo'),
  ('view_payroll', 'Ver folha de pagamento / valores pagos a professores'),
  ('view_bank_accounts', 'Ver dados de conexão bancária e saldos'),
  ('manage_users', 'Gerenciar usuários e papéis'),
  ('manage_invoices', 'Lançar e editar mensalidades'),
  ('manage_leads', 'Gerenciar CRM / pipeline de leads'),
  ('view_dashboards', 'Ver dashboards executivos e metas')
on conflict (code) do nothing;

insert into public.role_permissions (role, permission_id)
select 'owner', id from public.permissions
on conflict do nothing;

insert into public.role_permissions (role, permission_id)
select 'socio', id from public.permissions
where code in ('view_dashboards', 'manage_leads', 'manage_invoices')
on conflict do nothing;

insert into public.role_permissions (role, permission_id)
select 'funcionario', id from public.permissions
where code in ('manage_invoices', 'manage_leads')
on conflict do nothing;
