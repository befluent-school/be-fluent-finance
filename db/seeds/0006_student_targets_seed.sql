-- Seed de metas de alunos do mês corrente por plano (valores de partida
-- razoáveis; ajustáveis depois pelo owner/sócio).

insert into public.student_targets (reference_month, plan_id, target_count)
select date_trunc('month', current_date)::date, id, 5
from public.plans
on conflict (reference_month, plan_id) do nothing;
