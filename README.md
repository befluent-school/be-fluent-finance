# Be Fluent — Gestão Financeira e Administrativa

SaaS interno da Be Fluent para substituir a planilha `CONTROLE_FINANCEIRO.xlsx`: mensalidades,
fluxo de caixa, **contas a pagar/receber**, **Simples Nacional (DAS)**, CRM (lê o Beely),
indicadores (CAC/LTV/MRR), metas, tarefas, relatório anual e **automação de virada de mês/ano**.

Roda numa VPS própria (Hostinger), sem Supabase nem Render: Next.js + PostgreSQL 16 local.

## Plataforma financeira (o que ela faz)

- **Mensalidades (a receber)** — geração automática por matrícula ativa, multa/juros no atraso.
- **Contas a pagar** — lançamentos manuais, **recorrentes** (contador, pró-labore, SaaS…) e
  o **DAS** do Simples; cada um com vencimento e status próprio (pendente/atrasado/pago).
- **A Pagar / A Receber** (`/contas`) — posição consolidada de tudo em aberto + saldo projetado.
- **Impostos — Simples Nacional** (`/impostos`) — apuração do **Anexo III**: RBT12,
  faixa, alíquota efetiva e DAS do mês, com histórico. Fórmula:
  `efetiva = (RBT12 × nominal − dedução) / RBT12`; RBT12 proporcionalizada nos 1os 12 meses.
- **Automação de virada** (`/automacao`) — todo dia, de forma **idempotente**, gera as
  mensalidades do mês, as contas recorrentes e o DAS da competência fechada, e atualiza o
  que venceu. Roda via agendador do SO (`npm run rollover`), botão "Rodar agora", ou rede de
  segurança ao abrir o app. Config e histórico na própria tela. Ver [deploy/AUTOMACAO.md](deploy/AUTOMACAO.md).

## Estrutura

```
/frontend   Next.js 16 (App Router) + TypeScript + Tailwind — UI, Server Actions e acesso ao banco
  src/lib/db        Drizzle ORM + pg (server-only); withUser() = transação com RLS do usuário
  src/lib/auth      sessão em cookie HttpOnly, senhas (scrypt), TOTP, rate limit, auditoria
  scripts/          migrate.mjs (migrations), user-admin.mjs (usuários)
  tests/            unitários + RLS por papel no Postgres
/shared     Tipos TypeScript compartilhados
/db         Migrations SQL (PostgreSQL comum, com RLS) e seeds de desenvolvimento
/deploy     Passo a passo da VPS, PM2, Nginx, backup, update, migração do Supabase,
            relatório de segurança e plano de corte
```

## Segurança, em resumo
- Login próprio: e-mail + senha (scrypt) + **2FA TOTP obrigatório** (cadastro confirmado por código no e-mail), códigos de backup com HMAC.
- Sessão: cookie `__Host-` HttpOnly/Secure/SameSite=Lax, só o hash no banco, expiração deslizante, revogação no logout e na troca de senha.
- Autorização em duas camadas: política por papel em cada Server Action **e** RLS no Postgres (papel `financeiro_app` sem BYPASSRLS).
- CSRF (checagem de `Origin`), CSP com nonce, rate limit no app e no Nginx, auditoria automática por trigger.

Detalhes: [deploy/SEGURANCA.md](deploy/SEGURANCA.md).

## Rodar localmente
Ver "Desenvolvimento local" em [deploy/README.md](deploy/README.md). Resumo:
```bash
C:/pgsql16/bin/pg_ctl -D .pgdata -l .pgdata/server.log start   # cluster próprio, porta 5435
cd frontend
npm install
npm run db:migrate && npm run db:seed
npm run user -- create --email voce@teste.local --name "Você" --role owner
npm run dev
```

Comandos: `npm run typecheck` · `npm run lint` · `npm test` · `npm run build`.

## Produção
[deploy/README.md](deploy/README.md) (instalação) · [deploy/PLANO-DE-CORTE.md](deploy/PLANO-DE-CORTE.md) (migração do Supabase/Render).
