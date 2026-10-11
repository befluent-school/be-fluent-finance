-- Etapa 7: Simples Nacional (Anexo III — serviços de ensino) e o motor de
-- virada de mês/ano.
--
-- A Be Fluent é optante do Simples Nacional. Serviços de ensino de idiomas
-- se enquadram no ANEXO III. O imposto (DAS) de cada mês é:
--
--   alíquota efetiva = (RBT12 × alíquota_nominal − parcela_a_deduzir) / RBT12
--   DAS do mês       = receita_bruta_do_mês × alíquota efetiva
--
-- onde RBT12 = receita bruta acumulada dos 12 meses ANTERIORES ao da apuração.
-- Nos primeiros 12 meses de empresa usa-se a regra de proporcionalização
-- (receita do 1º mês × 12 no início; média dos meses disponíveis × 12 depois).
--
-- Tudo é calculado a partir dos dados transacionais reais (receita = entradas
-- de "Mensalidade de Aluno" e demais receitas no caixa), nunca gravado como
-- número solto — mesmo princípio de MRR/saldo/status efetivo.

-- ── Tabela progressiva do Anexo III (valores vigentes) ──────────────────────
-- 6 faixas por RBT12. nominal_rate em fração (ex.: 0.06 = 6%).
create table public.simples_brackets (
  anexo text not null,
  faixa integer not null check (faixa between 1 and 6),
  rbt12_min numeric(14, 2) not null,
  rbt12_max numeric(14, 2) not null,
  nominal_rate numeric(6, 4) not null,       -- alíquota nominal (fração)
  deduction numeric(14, 2) not null,         -- parcela a deduzir (R$)
  primary key (anexo, faixa)
);

-- Anexo III — Lei Complementar 123/2006 (tabela vigente desde 2018).
insert into public.simples_brackets (anexo, faixa, rbt12_min, rbt12_max, nominal_rate, deduction) values
  ('III', 1,        0.00,  180000.00, 0.0600,      0.00),
  ('III', 2,   180000.01,  360000.00, 0.1120,   9360.00),
  ('III', 3,   360000.01,  720000.00, 0.1350,  17640.00),
  ('III', 4,   720000.01, 1800000.00, 0.1600,  35640.00),
  ('III', 5,  1800000.01, 3600000.00, 0.2100, 125640.00),
  ('III', 6,  3600000.01, 4800000.00, 0.3300, 648000.00);

-- Também carregamos o Anexo V (algumas atividades de ensino caem nele quando
-- o Fator R < 28%), para o caso de a empresa precisar comparar — não é usado
-- por padrão, mas evita um "número mágico" caso o contador confirme Anexo V.
insert into public.simples_brackets (anexo, faixa, rbt12_min, rbt12_max, nominal_rate, deduction) values
  ('V', 1,        0.00,  180000.00, 0.1550,      0.00),
  ('V', 2,   180000.01,  360000.00, 0.1800,   4500.00),
  ('V', 3,   360000.01,  720000.00, 0.1950,   9900.00),
  ('V', 4,   720000.01, 1800000.00, 0.2050,  17100.00),
  ('V', 5,  1800000.01, 3600000.00, 0.2300,  62100.00),
  ('V', 6,  3600000.01, 4800000.00, 0.3050, 540000.00);

grant select on public.simples_brackets to financeiro_app;

-- ── Receita bruta por mês (competência) ────────────────────────────────────
-- Base da apuração do Simples: toda ENTRADA de caixa que seja receita da
-- atividade. Exclui transferências entre contas próprias e "Antecipação de
-- Recebíveis" (não é receita nova — é adiantamento de recebível já contado).
-- Usa cash_transactions (dinheiro efetivamente reconhecido no extrato), que é
-- o critério de regime de caixa que o Simples permite.
create view public.v_receita_bruta_mensal
with (security_invoker = true) as
select
  date_trunc('month', ct.date)::date as reference_month,
  sum(ct.amount) as receita_bruta
from public.cash_transactions ct
left join public.cost_categories cc on cc.id = ct.category_id
where ct.type = 'entrada'
  and coalesce(cc.name, '') not in ('Transferência entre Contas', 'Antecipação de Recebíveis')
group by date_trunc('month', ct.date);

-- ── RBT12: receita bruta dos 12 meses anteriores a um mês de apuração ───────
-- Regra de proporcionalização para empresa com < 12 meses:
--   - no 1º mês de atividade: RBT12 = receita do 1º mês × 12
--   - do 2º ao 12º mês: RBT12 = (média dos meses de atividade já encerrados) × 12
--   - a partir do 13º mês: soma real dos 12 meses anteriores
-- Quando não há nenhuma receita anterior, cai na faixa 1 (RBT12 = 0).
create or replace function public.simples_rbt12(p_apuracao date)
returns numeric
language plpgsql
stable
as $$
declare
  v_month date := date_trunc('month', p_apuracao)::date;
  v_start date;
  v_sum numeric;
  v_count integer;
begin
  -- Soma real dos 12 meses anteriores (não inclui o mês de apuração).
  select coalesce(sum(receita_bruta), 0)
    into v_sum
  from public.v_receita_bruta_mensal
  where reference_month >= (v_month - interval '12 months')::date
    and reference_month < v_month;

  -- Quantos meses de receita ANTERIORES ao mês de apuração existem de fato.
  select count(*)
    into v_count
  from public.v_receita_bruta_mensal
  where reference_month < v_month;

  if v_count >= 12 then
    return v_sum;
  elsif v_count = 0 then
    -- Sem histórico: início de atividade. A base será a própria receita do
    -- mês de apuração × 12 (proporcionalização do 1º mês), calculada aqui a
    -- partir do mês de apuração se já houver receita nele.
    select coalesce(sum(receita_bruta), 0) * 12
      into v_sum
    from public.v_receita_bruta_mensal
    where reference_month = v_month;
    return v_sum;
  else
    -- 1..11 meses de histórico: média dos meses anteriores × 12.
    return (v_sum / v_count) * 12;
  end if;
end;
$$;

grant execute on function public.simples_rbt12(date) to financeiro_app;

-- ── Alíquota efetiva e DAS para um mês de apuração ──────────────────────────
-- Retorna a linha com RBT12, faixa, alíquota nominal, dedução, alíquota
-- efetiva, receita do mês e o DAS devido.
create or replace function public.simples_apuracao(p_apuracao date, p_anexo text default null)
returns table (
  reference_month date,
  anexo text,
  rbt12 numeric,
  faixa integer,
  nominal_rate numeric,
  deduction numeric,
  effective_rate numeric,
  receita_mes numeric,
  das numeric
)
language plpgsql
stable
as $$
declare
  v_month date := date_trunc('month', p_apuracao)::date;
  v_anexo text := coalesce(p_anexo, (select value #>> '{}' from public.app_settings where key = 'simples_anexo'), 'III');
  v_rbt12 numeric := public.simples_rbt12(v_month);
  v_receita numeric;
  v_bracket record;
  v_eff numeric;
begin
  select coalesce(sum(vr.receita_bruta), 0) into v_receita
  from public.v_receita_bruta_mensal vr
  where vr.reference_month = v_month;

  -- Seleciona a faixa pela RBT12. Acima do teto (4,8 mi) usa a última faixa.
  select * into v_bracket
  from public.simples_brackets b
  where b.anexo = v_anexo
    and v_rbt12 >= b.rbt12_min
    and (v_rbt12 <= b.rbt12_max or b.faixa = 6)
  order by b.faixa
  limit 1;

  if v_bracket is null then
    -- Anexo desconhecido: devolve zeros em vez de quebrar a automação.
    return query select v_month, v_anexo, v_rbt12, null::integer, null::numeric,
                        null::numeric, 0::numeric, v_receita, 0::numeric;
    return;
  end if;

  if v_rbt12 > 0 then
    v_eff := (v_rbt12 * v_bracket.nominal_rate - v_bracket.deduction) / v_rbt12;
  else
    -- Sem base ainda: usa a alíquota nominal da 1ª faixa (6% no Anexo III).
    v_eff := v_bracket.nominal_rate;
  end if;
  if v_eff < 0 then v_eff := 0; end if;

  return query select
    v_month,
    v_anexo,
    round(v_rbt12, 2),
    v_bracket.faixa,
    v_bracket.nominal_rate,
    v_bracket.deduction,
    round(v_eff, 6),
    round(v_receita, 2),
    round(v_receita * v_eff, 2);
end;
$$;

grant execute on function public.simples_apuracao(date, text) to financeiro_app;

-- View de conveniência: apuração de cada mês que teve receita, já pronta para
-- listar na tela de impostos.
create view public.v_simples_apuracao
with (security_invoker = true) as
select a.*
from public.v_receita_bruta_mensal r
cross join lateral public.simples_apuracao(r.reference_month) a;
