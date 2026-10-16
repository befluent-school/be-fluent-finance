-- Categorização automática dos lançamentos vindos dos bancos (ASAAS/Inter).
--
-- Sem categoria, o lançamento some dos relatórios por categoria e do CAC
-- (v_cac_by_month só soma "Marketing e Vendas"). As regras abaixo saem das
-- descrições reais dos extratos e só tocam lançamentos SEM categoria — uma
-- categoria escolhida à mão nunca é sobrescrita.
--
-- Fica de fora de propósito:
--   * "Antecipação - fatura …": a receita (0041) conta a antecipação e desconta
--     a "Baixa da antecipação"; categorizá-la zeraria a receita do mês.
--   * "Estorno …": a receita usa a descrição para descontar estornos.
--   * Pix para pessoas que não são professores cadastrados.

create or replace function public.categorizar_lancamentos_bancarios()
returns integer
language plpgsql
as $$
declare
  v_total integer := 0;
  v_n integer;
begin
  -- Regras por descrição (padrão ILIKE, tipo, categoria).
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

  -- Pix enviado a um professor cadastrado (nome completo na descrição).
  update public.cash_transactions ct
     set category_id = cc.id
    from public.cost_categories cc
   where cc.name = 'Pagamento Professores'
     and ct.category_id is null
     and ct.type = 'saida'
     and ct.source in ('asaas', 'inter', 'api_sync')
     and ct.description ilike '%PIX ENVIADO%'
     and exists (
       -- O Inter trunca o favorecido: compara os dois primeiros nomes.
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

grant execute on function public.categorizar_lancamentos_bancarios() to financeiro_app;

-- Aplica no histórico já importado.
select public.categorizar_lancamentos_bancarios();
