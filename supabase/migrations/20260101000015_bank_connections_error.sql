-- Registra o motivo da última falha de sincronização, para exibir na UI
-- em vez de deixar o status "error" sem explicação.
alter table public.bank_connections add column last_error text;
