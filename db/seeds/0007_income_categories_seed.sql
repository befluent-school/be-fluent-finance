-- Categorias de receita (entrada) — até aqui só existiam categorias de
-- despesa. A direção (entrada/saída) é decidida por cash_transactions.type,
-- então "Outro" serve para os dois lados sem precisar de coluna nova.
-- Também adiciona "Taxas Asaas", recorrente nos extratos importados
-- (notificação, boleto/cartão/Pix, mensageria) e hoje sem categoria própria.

insert into public.cost_categories (name, type) values
  ('Mensalidade de Aluno', 'variable'),
  ('Antecipação de Recebíveis', 'variable'),
  ('Outras Receitas', 'variable'),
  ('Taxas Asaas', 'variable'),
  ('Outro', 'variable')
on conflict (name) do nothing;
