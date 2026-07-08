# Be Fluent — Gestão Financeira e Administrativa

SaaS interno da Be Fluent para substituir a planilha `CONTROLE_FINANCEIRO.xlsx`: mensalidades,
fluxo de caixa, CRM, indicadores (CAC/LTV/MRR), contabilidade simplificada (razonetes, DRE,
balanço) e um laboratório de ideias com IA.

## Estrutura

```
/frontend   Next.js 16 (App Router) + TypeScript + Tailwind — UI e Server Actions
/shared     Tipos TypeScript compartilhados (enums, schemas Zod)
/supabase   Migrations SQL e seeds (Postgres + RLS)
```

## Setup local

1. Crie um projeto em [supabase.com](https://supabase.com) e copie `.env.example` para
   `frontend/.env.local`, preenchendo as chaves do Supabase.
2. Rode as migrations em `supabase/migrations/` (em ordem numérica) no SQL Editor do
   Supabase, seguidas dos seeds em `supabase/seeds/`.
3. No Supabase Dashboard, habilite **Auth > Providers > Email** e **Auth > MFA (TOTP)**.
4. `cd frontend && npm install && npm run dev`

## Etapas de entrega

1. ✅ Fundação: auth, 2FA (TOTP) obrigatório, papéis (owner/socio/funcionario), auditoria.
2. ✅ Alunos & mensalidades.
3. ✅ Fluxo de caixa manual.
4. ✅ Dashboard de indicadores (CAC, LTV, MRR, metas).
5. ✅ Integração Pluggy (Open Finance) — conexão via widget, importação de transações,
   tela de conciliação em `/banco/conciliacao`. Requer `PLUGGY_CLIENT_ID`/`PLUGGY_CLIENT_SECRET`
   e `NEXT_PUBLIC_APP_URL` configurados para funcionar de fato (não testável sem credenciais
   reais da Pluggy — testado apenas visualmente e com typecheck/build).
6. CRM.
7. Contábil (razonetes, DRE, balanço).
8. Laboratório de Ideias (Claude API).

Veja o plano completo em `C:\Users\usuario\.claude\plans\cozy-foraging-galaxy.md`.
