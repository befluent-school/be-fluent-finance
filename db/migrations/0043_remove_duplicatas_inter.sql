-- Duplicatas do Inter criadas pela correção de tipo da 0036.
--
-- Lançamentos do Inter sem id do banco usam a chave de dedupe
-- "data|descrição|valor|tipo|conta". A 0036 trocou o tipo (entrada → saída)
-- mas não a chave, que continuou dizendo "entrada". O sync seguinte trouxe o
-- mesmo lançamento já como saída, com chave nova, e ele entrou de novo:
-- a saída contava duas vezes no saldo.
--
-- 1. Cópia antiga (chave com tipo errado) que tem gêmea idêntica: os vínculos
--    passam para a gêmea e a cópia é apagada.
-- 2. Sem gêmea: só corrige a chave, para o próximo sync não duplicar.

create temporary table _inter_dup on commit drop as
select a.id as old_id,
       (select b.id
          from public.cash_transactions b
         where b.id <> a.id
           and b.source = a.source
           and b.date = a.date
           and b.amount = a.amount
           and b.type = a.type
           and b.description = a.description
           and split_part(b.dedupe_key, '|', 4) = b.type
         order by b.created_at
         limit 1) as twin_id
  from public.cash_transactions a
 where a.source = 'inter'
   and a.dedupe_key not like 'inter:%'
   and split_part(a.dedupe_key, '|', 4) <> a.type;

-- Vínculos: só passam para a gêmea se ela ainda não tiver um (invoices é único).
update public.invoices i
   set cash_transaction_id = d.twin_id
  from _inter_dup d
 where i.cash_transaction_id = d.old_id
   and d.twin_id is not null
   and not exists (select 1 from public.invoices x where x.cash_transaction_id = d.twin_id);

update public.payables p
   set cash_transaction_id = d.twin_id
  from _inter_dup d
 where p.cash_transaction_id = d.old_id
   and d.twin_id is not null;

update public.bank_transactions_staging s
   set reconciled_cash_transaction_id = d.twin_id
  from _inter_dup d
 where s.reconciled_cash_transaction_id = d.old_id
   and d.twin_id is not null;

-- A gêmea herda a categoria escolhida na cópia antiga, se ainda não tiver.
update public.cash_transactions t
   set category_id = o.category_id
  from _inter_dup d
  join public.cash_transactions o on o.id = d.old_id
 where t.id = d.twin_id
   and t.category_id is null
   and o.category_id is not null;

delete from public.cash_transactions c
 using _inter_dup d
 where c.id = d.old_id
   and d.twin_id is not null;

update public.cash_transactions c
   set dedupe_key = concat_ws('|',
         split_part(c.dedupe_key, '|', 1),
         split_part(c.dedupe_key, '|', 2),
         split_part(c.dedupe_key, '|', 3),
         c.type,
         split_part(c.dedupe_key, '|', 5))
  from _inter_dup d
 where c.id = d.old_id
   and d.twin_id is null;
