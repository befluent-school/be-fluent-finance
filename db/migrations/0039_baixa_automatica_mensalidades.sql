-- Baixa automática de mensalidades a partir das cobranças recebidas no ASAAS.
--
-- Sem isto, mensalidades pagas no ASAAS continuavam "atrasadas" até alguém
-- marcá-las à mão, inflando a inadimplência do Dashboard.
--
-- Regra (conservadora — na dúvida, não baixa):
--   lançamento "Cobrança recebida - fatura nr. N <Nome>" no caixa
--   + aluno (ou responsável financeiro) com exatamente esse nome
--   + mensalidade em aberto desse aluno com o mesmo valor
--   → baixa a mais antiga, com a data do recebimento e a forma inferida da
--     taxa do ASAAS (Pix / boleto / cartão) da mesma fatura.
-- Cada lançamento do caixa baixa no máximo uma mensalidade.

alter table public.invoices
  add column if not exists cash_transaction_id uuid unique
    references public.cash_transactions (id) on delete set null;

create or replace function public.normalizar_nome(t text)
returns text
language sql
immutable
as $$
  select btrim(regexp_replace(lower(translate(coalesce(t, ''),
    'ÁÀÂÃÄáàâãäÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÕÖóòôõöÚÙÛÜúùûüÇçÑñ',
    'AAAAAaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCcNn')), '\s+', ' ', 'g'));
$$;

create or replace function public.baixar_mensalidades_por_extrato()
returns integer
language plpgsql
as $$
declare
  r record;
  v_invoice uuid;
  v_metodo text;
  v_n integer := 0;
begin
  for r in
    select
      ct.id,
      ct.date,
      ct.amount,
      substring(ct.description from 'fatura nr\. (\d+)') as fatura,
      public.normalizar_nome(
        regexp_replace(
          regexp_replace(
            regexp_replace(ct.description, '^Cobrança recebida - fatura nr\. \d+ ', ''),
            '\s*\([^()]*\)\s*$', ''),
          '\. Nota fiscal nr\. \d+$', '')
      ) as nome
    from public.cash_transactions ct
    where ct.type = 'entrada'
      and ct.description like 'Cobrança recebida - fatura nr. %'
      and not exists (select 1 from public.invoices i where i.cash_transaction_id = ct.id)
    order by ct.date, ct.id
  loop
    continue when r.nome = '';

    select i.id into v_invoice
    from public.invoices i
    join public.enrollments e on e.id = i.enrollment_id
    join public.students s on s.id = e.student_id
    where i.paid_date is null
      and abs(i.amount - r.amount) < 0.01
      and (public.normalizar_nome(s.full_name) = r.nome or public.normalizar_nome(s.payer_name) = r.nome)
      and i.reference_month <= (date_trunc('month', r.date) + interval '1 month')::date
    order by i.due_date
    limit 1;

    continue when v_invoice is null;

    select case
      when bool_or(description like 'Taxa do Pix - fatura nr. ' || r.fatura || ' %') then 'pix'
      when bool_or(description like 'Taxa de boleto - fatura nr. ' || r.fatura || ' %') then 'boleto'
      when bool_or(description like 'Taxa de cartão - fatura nr. ' || r.fatura || ' %') then 'cartao'
      else 'pix'
    end into v_metodo
    from public.cash_transactions
    where description like 'Taxa %fatura nr. ' || r.fatura || ' %';

    update public.invoices
       set paid_date = r.date,
           payment_method = v_metodo,
           total_paid = r.amount,
           cash_transaction_id = r.id
     where id = v_invoice;
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

grant execute on function public.normalizar_nome(text) to financeiro_app;
grant execute on function public.baixar_mensalidades_por_extrato() to financeiro_app;
