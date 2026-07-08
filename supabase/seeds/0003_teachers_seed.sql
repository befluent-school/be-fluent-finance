-- Seed dos professores já ativos na Be Fluent, com o modelo de pagamento de
-- cada um em texto livre (cada professor tem uma regra diferente hoje).

insert into public.teachers (full_name, payment_rule_text, payment_reference_value) values
  ('Isabella', 'Repasse integral por aula (100% do valor pago pelo aluno)', null),
  ('Marianna', 'Comissão de 58,33% sobre a receita gerada', 58.33),
  ('Bianca', 'R$ 35,00 por hora de aula', 35.00),
  ('Nilton', 'R$ 35,00 por hora de aula', 35.00)
on conflict (full_name) do nothing;
