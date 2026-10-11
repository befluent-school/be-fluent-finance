-- Seed das categorias de custo com base na taxonomia real da aba "CUSTOS"
-- da planilha legada (a mais limpa e consistente do arquivo original).

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
