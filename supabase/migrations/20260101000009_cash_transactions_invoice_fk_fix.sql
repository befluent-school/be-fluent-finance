-- cash_transactions.invoice_id não tinha ON DELETE definido, o que bloqueava
-- a exclusão de uma invoice (e em cascata, de um aluno) enquanto existisse
-- uma transação de caixa vinculada a ela. A transação de caixa é o registro
-- contábil do que aconteceu e deve sobreviver à exclusão da fatura de origem.

alter table public.cash_transactions
  drop constraint cash_transactions_invoice_id_fkey,
  add constraint cash_transactions_invoice_id_fkey
    foreign key (invoice_id) references public.invoices (id) on delete set null;
