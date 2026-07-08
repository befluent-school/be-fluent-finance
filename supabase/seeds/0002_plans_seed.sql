-- Seed dos planos de mentoria individual, com base nos valores de rebranding
-- vigentes na planilha (aba "LTV x CAC (NOVO REBRANDING)").
-- Duração média estimada em 12 meses para todos os planos até haver dado real
-- de churn suficiente para recalcular por plano.

insert into public.plans (name, lessons_per_week, monthly_value, avg_duration_months) values
  ('Bronze', 1, 357.00, 12),
  ('Silver', 2, 697.00, 12),
  ('Gold', 3, 997.00, 12),
  ('Diamond', 4, 1367.00, 12),
  ('VIP', 5, 1697.00, 12)
on conflict (name) do nothing;
