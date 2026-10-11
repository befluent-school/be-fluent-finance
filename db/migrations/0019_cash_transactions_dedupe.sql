-- Convertida do Supabase (20260101000019) sem alterações de schema.

-- Deduplica transações vindas de importação de extrato: reimportar o mesmo
-- arquivo (ou uma transação que já apareceu em outra importação com mesma
-- data/descrição/valor/tipo) não deve criar lançamento duplicado.
-- Constraint UNIQUE de verdade (não índice parcial) — PostgREST exige isso
-- para aceitar ON CONFLICT no upsert (mesma lição já aplicada em
-- bank_transactions_staging).
alter table public.cash_transactions add column dedupe_key text;

alter table public.cash_transactions
  add constraint cash_transactions_dedupe_key_key unique (dedupe_key);

-- Categoria para transferências entre as próprias contas da Be Fluent (ex:
-- repasse Asaas -> Inter) — a mesma movimentação aparece nos extratos de
-- ambos os bancos, então é excluída dos totais de entrada/saída do Fluxo de
-- Caixa (não é receita nem despesa real), mas continua listada para
-- rastreabilidade.
insert into public.cost_categories (name, type) values
  ('Transferência entre Contas', 'variable')
on conflict (name) do nothing;
