-- Etapa 9: Conexões bancárias por API oficial (sincronização automática).
--
-- Em vez de importar extrato CSV à mão, o sistema busca as transações direto
-- na API de cada banco e lança no fluxo de caixa com o mesmo dedupe já usado
-- na importação manual. Genérico: um "provider" por conta conectada, hoje
-- Inter (mTLS + OAuth2) e ASAAS (API key), amanhã outros bancos sem mudar o
-- schema.
--
-- Credenciais são SEGREDO: ficam cifradas (AES-256-GCM com APP_SECRET, via
-- src/lib/auth/tokens.ts) na coluna credentials_enc. O banco nunca guarda a
-- chave/senha em claro, e a aplicação só decifra em memória na hora de chamar
-- a API. O papel da aplicação não tem como ler o APP_SECRET.

create table public.bank_providers (
  id uuid primary key default gen_random_uuid(),
  -- tipo do conector: define qual integração roda. Novos bancos entram aqui.
  provider text not null check (provider in ('asaas', 'inter', 'generic_api', 'manual')),
  -- rótulo que aparece no fluxo de caixa (ex.: "Inter PJ", "ASAAS").
  label text not null unique,
  -- config NÃO sensível e parametrizável (host, caminho do extrato, conta
  -- corrente, ambiente sandbox/prod). Fica em claro para a tela poder editar.
  config jsonb not null default '{}'::jsonb,
  -- credenciais cifradas (jsonb cifrado como texto). Null = ainda não configurado.
  credentials_enc text,
  active boolean not null default true,
  -- janela padrão de sincronização (dias para trás) a cada execução.
  sync_window_days integer not null default 35 check (sync_window_days between 1 and 90),
  -- controle de sincronização incremental.
  last_synced_at timestamptz,
  last_synced_through date,          -- data da última transação já trazida
  last_status text not null default 'novo' check (last_status in ('novo', 'ok', 'erro')),
  last_error text,
  last_imported_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_bank_providers_active on public.bank_providers (active);

create trigger trg_bank_providers_updated_at before update on public.bank_providers
  for each row execute function public.set_updated_at();

-- cash_transactions.source passa a aceitar as origens automáticas por API.
-- (Antes: manual, pluggy, manual_import.)
alter table public.cash_transactions drop constraint cash_transactions_source_check;
alter table public.cash_transactions add constraint cash_transactions_source_check
  check (source in ('manual', 'pluggy', 'manual_import', 'asaas', 'inter', 'api_sync'));

-- Liga cada lançamento automático ao provider que o trouxe (rastreabilidade;
-- não bloqueia exclusão do provider — o lançamento contábil sobrevive).
alter table public.cash_transactions
  add column bank_provider_id uuid references public.bank_providers (id) on delete set null;

create index idx_cash_transactions_provider on public.cash_transactions (bank_provider_id);

-- ── RLS ────────────────────────────────────────────────────────────────────
-- Dados bancários são sensíveis: só owner/socio (mesma regra de
-- bank_connections). Credenciais nunca saem por SELECT comum porque a coluna
-- credentials_enc está cifrada; ainda assim, restringimos o acesso à tabela.
alter table public.bank_providers enable row level security;

create policy "bank_providers_select_owner_or_socio"
  on public.bank_providers for select
  using (public.current_role_name() in ('owner', 'socio'));

create policy "bank_providers_write_owner_or_socio"
  on public.bank_providers for all
  using (public.current_role_name() in ('owner', 'socio'))
  with check (public.current_role_name() in ('owner', 'socio'));

-- ── Auditoria ──────────────────────────────────────────────────────────────
-- Auditoria registra alterações, mas o valor cifrado (credentials_enc) acaba
-- indo para o audit_log em old/new_data. Isso é aceitável: continua cifrado e
-- o audit_log é inacessível ao papel da aplicação. Mantém o padrão do projeto.
create trigger trg_bank_providers_audit
  after insert or update or delete on public.bank_providers
  for each row execute function app.audit_row_change();

-- ── Grants para o papel da aplicação ───────────────────────────────────────
grant select, insert, update, delete on public.bank_providers to financeiro_app;

-- ── Seed opcional de provedores "em branco" ────────────────────────────────
-- Cria as duas conexões já esperadas, inativas e sem credencial, para a dona
-- apenas preencher as credenciais na tela. Config já vem com os defaults
-- públicos corretos de cada API (editáveis).
insert into public.bank_providers (provider, label, active, config) values
  (
    'asaas', 'ASAAS', false,
    jsonb_build_object(
      'base_url', 'https://api.asaas.com/v3',
      'sandbox', false
    )
  ),
  (
    'inter', 'Inter PJ', false,
    jsonb_build_object(
      'base_url', 'https://cdpj.partners.bancointer.com.br',
      'token_path', '/oauth/v2/token',
      'extrato_path', '/banking/v2/extrato',
      'scope', 'extrato.read',
      'conta_corrente', ''
    )
  )
on conflict (label) do nothing;
