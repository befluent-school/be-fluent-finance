-- RLS da tabela de referência simples_brackets.
--
-- É tabela estática (tabela progressiva do Simples), mas o contrato de
-- segurança do projeto exige RLS em TODA tabela do schema public
-- (ver tests/db/rls.test.ts). Leitura liberada para todo autenticado;
-- não há escrita pela aplicação (só migrations, como dono do banco).

alter table public.simples_brackets enable row level security;

create policy "simples_brackets_select_authenticated"
  on public.simples_brackets for select
  using (app.is_authenticated());
