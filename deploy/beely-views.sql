-- ============================================================================
-- Contrato de leitura Financeiro → Beely CRM
-- Aplicar NO BANCO `beely_crm` (como dono do banco do Beely), depois que o
-- Beely estiver na VPS. Pode virar uma migration do repositório do Beely.
--
-- O Financeiro conecta com o papel `financeiro_leitor` (criado pelo
-- superusuário, ver deploy/README.md §3) e só enxerga estas três views.
-- Colunas = o mínimo que a tela /crm do Financeiro usa:
--   contacts: id, name, email, phone        (e-mail/telefone só para
--             pré-preencher a matrícula e detectar quem já é aluno)
--   deals:    id, title, value, status ('open'|'won'|'lost'), stage_id,
--             contact (nome em texto livre), contact_id, owner, created_at
--   stages:   id, name, position
-- Se o Beely renomear colunas, ajuste só o SELECT das views — o contrato
-- (nomes das colunas expostas) não muda e o Financeiro não precisa de deploy.
-- ============================================================================

create schema if not exists financeiro_api;

create or replace view financeiro_api.contacts as
  select id, name, email, phone
    from public.contacts;

create or replace view financeiro_api.deals as
  select id, title, value, status, stage_id, contact, contact_id, owner, created_at
    from public.deals;

create or replace view financeiro_api.stages as
  select id, name, position
    from public.stages;

-- Permissões: nada além de SELECT nas três views.
revoke all on schema financeiro_api from public;
grant usage on schema financeiro_api to financeiro_leitor;
revoke all on all tables in schema financeiro_api from financeiro_leitor;
grant select on financeiro_api.contacts, financeiro_api.deals, financeiro_api.stages to financeiro_leitor;
-- Sem acesso direto às tabelas do Beely:
revoke all on all tables in schema public from financeiro_leitor;
revoke create on schema public from financeiro_leitor;

-- Se o Beely usar RLS nas tabelas de origem: as views acima rodam com os
-- privilégios do DONO da view (comportamento padrão, sem security_invoker),
-- então o leitor vê todos os contatos/negócios — que é o esperado para o
-- Financeiro. Não conceda nada além disso.
