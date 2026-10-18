-- Regras de categorização aprendidas com o usuário.
--
-- Ao categorizar um lançamento do banco e marcar "sempre categorizar assim",
-- grava-se uma regra (trecho da descrição + tipo → categoria). A função de
-- categorização aplica essas regras ANTES das regras fixas (0042), sempre só
-- em lançamentos sem categoria. Com isso o trabalho manual não se repete
-- todo mês: o fornecedor categorizado uma vez é reconhecido nos próximos syncs.

create table public.categorization_rules (
  id uuid primary key default gen_random_uuid(),
  pattern text not null check (length(btrim(pattern)) >= 3),
  type text not null check (type in ('entrada', 'saida')),
  category_id uuid not null references public.cost_categories (id) on delete cascade,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (pattern, type)
);

alter table public.categorization_rules enable row level security;

create policy "categorization_rules_select_authenticated"
  on public.categorization_rules for select
  using (app.is_authenticated());

create policy "categorization_rules_write_with_permission"
  on public.categorization_rules for all
  using (public.has_permission('manage_invoices'))
  with check (public.has_permission('manage_invoices'));

grant select, insert, update, delete on public.categorization_rules to financeiro_app;

create or replace function public.categorizar_lancamentos_bancarios()
returns integer
language plpgsql
as $$
declare
  v_total integer := 0;
  v_n integer;
begin
  -- 1. Regras do usuário (trecho mais longo vence quando duas casam).
  with alvo as (
    select distinct on (ct.id) ct.id, r.category_id
      from public.cash_transactions ct
      join public.categorization_rules r
        on r.type = ct.type
       and position(public.normalizar_nome(r.pattern) in public.normalizar_nome(ct.description)) > 0
     where ct.category_id is null
       and ct.source in ('asaas', 'inter', 'api_sync', 'manual_import')
       and ct.description not ilike 'Estorno%'
       and ct.description not ilike 'Antecipação%'
     order by ct.id, length(r.pattern) desc
  )
  update public.cash_transactions ct
     set category_id = alvo.category_id
    from alvo
   where ct.id = alvo.id;
  get diagnostics v_n = row_count;
  v_total := v_total + v_n;

  -- 2. Regras fixas tiradas dos extratos reais (0042).
  with regras(padrao, tipo, categoria) as (
    values
      ('Cobrança recebida%',            'entrada', 'Mensalidade de Aluno'),
      ('Taxa d%',                       'saida',   'Taxas Asaas'),
      ('%PAGAMENTO DARF%',              'saida',   'Impostos'),
      ('%Pagamento Darf%',              'saida',   'Impostos'),
      ('%SIMPLES NACIONAL%',            'saida',   'Impostos'),
      ('%PIX ENVIADO%ROCKET%',          'saida',   'Marketing e Vendas'),
      ('%PIX ENVIADO%CONTABI%',         'saida',   'Assessoria Contábil')
  ),
  alvo as (
    select distinct on (ct.id) ct.id, cc.id as category_id
      from public.cash_transactions ct
      join regras r on ct.description ilike r.padrao and ct.type = r.tipo
      join public.cost_categories cc on cc.name = r.categoria
     where ct.category_id is null
       and ct.source in ('asaas', 'inter', 'api_sync')
       and ct.description not ilike 'Estorno%'
     order by ct.id
  )
  update public.cash_transactions ct
     set category_id = alvo.category_id
    from alvo
   where ct.id = alvo.id;
  get diagnostics v_n = row_count;
  v_total := v_total + v_n;

  -- 3. Pix enviado a um professor cadastrado (dois primeiros nomes).
  update public.cash_transactions ct
     set category_id = cc.id
    from public.cost_categories cc
   where cc.name = 'Pagamento Professores'
     and ct.category_id is null
     and ct.type = 'saida'
     and ct.source in ('asaas', 'inter', 'api_sync')
     and ct.description ilike '%PIX ENVIADO%'
     and exists (
       select 1
         from public.teachers t
         cross join lateral (
           select array_to_string((string_to_array(public.normalizar_nome(t.full_name), ' '))[1:2], ' ') as nome
         ) n
        where n.nome like '% %'
          and position(n.nome in public.normalizar_nome(ct.description)) > 0
     );
  get diagnostics v_n = row_count;
  v_total := v_total + v_n;

  return v_total;
end;
$$;
