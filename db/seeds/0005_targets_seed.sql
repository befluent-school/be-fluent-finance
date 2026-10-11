-- Seed da meta de faturamento do mês corrente, com base no valor de
-- referência da aba "META FATURAMENTO" da planilha (R$30.000).

insert into public.revenue_targets (reference_month, target_amount)
values (date_trunc('month', current_date)::date, 30000.00)
on conflict (reference_month) do nothing;
