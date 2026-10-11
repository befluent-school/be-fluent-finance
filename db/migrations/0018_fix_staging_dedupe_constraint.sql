-- Convertida do Supabase (20260101000018) sem alterações de schema.

-- O índice único parcial anterior não é aceito pelo PostgREST em ON CONFLICT
-- (upsert exige uma constraint UNIQUE/PK real, não um índice parcial).
-- Substitui por uma constraint UNIQUE de verdade; como import_dedupe_key só
-- é preenchido em importações manuais, linhas antigas da Pluggy continuam
-- com o valor null, e uma constraint UNIQUE comum já trata múltiplos nulls
-- como não conflitantes (comportamento padrão do Postgres).
drop index if exists public.idx_staging_import_dedupe;

alter table public.bank_transactions_staging
  add constraint bank_transactions_staging_dedupe_key_key unique (import_dedupe_key);
