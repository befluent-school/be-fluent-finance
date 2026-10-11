# Relatório de segurança — migração para a VPS (branch `vps-migration`)

Escopo: código em `frontend/`, `shared/`, migrations do Supabase e histórico do git (12 commits, `19955ed`…`f5cb729`).
Formato: **problema → risco → correção**. Severidade considera dados financeiros e CPF de alunos.

## 1. Varredura de segredos

| Onde | Resultado |
|---|---|
| Histórico do git (todos os commits, `git log -p --all`) | **Nenhum segredo.** Procurados: JWT do Supabase (`eyJ…`), `service_role`, chaves `sk-ant-`/`sk-`, URLs `postgres://usuário:senha@`, e os **valores reais** de cada variável do `frontend/.env.local` comparados byte a byte com o histórico. Única ocorrência: `NEXT_PUBLIC_APP_URL` (localhost — não é segredo). |
| Arquivos versionados | Nenhum segredo. `.env.local` sempre esteve no `.gitignore`. |
| Bundle do navegador (`.next/static`) | Nenhuma chave. A anon key do Beely (`NEXT_PUBLIC_BEELY_*`) só era usada no servidor, então não chegou ao navegador — mas o prefixo `NEXT_PUBLIC_` deixava isso a um import de distância. Agora é `BEELY_SUPABASE_*` (só servidor). |
| `frontend/.env.local` (só nesta máquina) e variáveis do Render | Contêm chaves reais: `SUPABASE_SERVICE_ROLE_KEY` (**não usada por nenhum código** desde jul/2026 — exposição sem necessidade), `ANTHROPIC_API_KEY`, `PLUGGY_CLIENT_ID/SECRET` (integração desligada), anon keys do Supabase do Financeiro e do Beely. |

**Nada vazou para o git — não é preciso reescrever histórico.** Rotação recomendada (higiene, não emergência):

| Segredo | Ação | Quando |
|---|---|---|
| Pluggy client id/secret | Revogar no painel da Pluggy e apagar o webhook cadastrado lá | Já (integração desligada) |
| `SUPABASE_SERVICE_ROLE_KEY` | Apagar do Render e deste `.env.local`; morre junto com o projeto Supabase | No desligamento |
| `ANTHROPIC_API_KEY` | Criar chave **nova e exclusiva** para o Financeiro na VPS; revogar a atual após o corte | No corte |
| Senha do banco Supabase | Usada uma vez no `migrate-from-supabase.sh`; trocar depois do dump final | No corte |
| Anon key do Beely | Pública por definição, mas sai de uso quando `BEELY_SOURCE=postgres` | Quando o Beely migrar |

## 2. Achados da auditoria (estado antes desta branch)

| # | Sev. | Problema | Risco | Correção nesta branch |
|---|---|---|---|---|
| 1 | **Crítica** | Policy `profiles_update_self_or_owner` permitia ao próprio usuário atualizar a sua linha em `profiles`, **inclusive a coluna `role`**. | Funcionário chamando a API REST do Supabase (JWT do próprio cookie, que não era HttpOnly, + anon key) virava `owner`: lucro líquido, auditoria, dados bancários. | Policy agora é só do owner (`0002`). Teste `tests/db/rls.test.ts` prova que o funcionário não consegue se promover. |
| 2 | Alta | Nenhuma Server Action checava papel no código: toda a autorização dependia do RLS do Supabase. | Ao sair do Supabase, cada action ficaria aberta a qualquer logado. | `getActionUser(Policy)` em **todas** as actions (`src/lib/auth/session.ts` + `policies.ts`) **e** RLS mantido no Postgres (duas camadas independentes). |
| 3 | Alta | Next.js 16.2.10 com avisos críticos (bypass do proxy/middleware, RCE no otimizador de imagens, SSRF em Server Actions, DoS). | Comprometimento do servidor / contorno da autenticação. | Next **16.3.8**. `npm audit --omit=dev`: **0 vulnerabilidades**. (Restam avisos só em ferramentas de desenvolvimento — `braces` via `eslint-config-next` — que não vão para o servidor.) |
| 4 | Alta | `xlsx` 0.18.5 do npm (prototype pollution, ReDoS) lendo planilhas enviadas por usuários. | Travamento/abuso no navegador de quem importa. | SheetJS **0.20.3** (distribuição oficial `cdn.sheetjs.com`, versão corrigida). |
| 5 | Alta | Totais financeiros calculados no navegador/servidor a partir de `select` sem limite: o PostgREST corta em **1.000 linhas**. Saldo total do dashboard, evolução do fluxo de caixa e relatório anual ficavam **errados** acima de 1.000 lançamentos. | Decisão com número errado, sem nenhum aviso. | Somas e agrupamentos feitos no SQL (`sum`/`group by`). Ensaio com 1.500 lançamentos conferido. **Vale conferir os números de produção atuais** se já passaram de 1.000 lançamentos. |
| 6 | Média | `active = false` no profile não bloqueava nada (login e dados continuavam). | Ex-funcionário com acesso. | RLS só reconhece profile ativo (`current_role_name`, `is_authenticated`); login recusa; `npm run user -- deactivate` também derruba as sessões. |
| 7 | Média | Login: sem rate limit próprio, senha mínima de 6, sem bloqueio. | Força bruta / senhas fracas. | Limite por e-mail (8 falhas/15 min) e por IP (30), bloqueio de 15 min após 10 falhas, `limit_req` no Nginx; senha ≥ 10 sem senhas óbvias; mesmo tempo de resposta exista ou não o e-mail. |
| 8 | Média | Troca de senha sem pedir a senha atual e sem encerrar outras sessões. | Sessão sequestrada vira conta tomada. | Pede a senha atual; encerra as outras sessões; redefinição por e-mail encerra **todas**. |
| 9 | Média | Códigos de backup do 2FA com SHA-256 sem sal (40 bits). | Se o banco vazar, quebráveis offline em horas. | HMAC-SHA256 com segredo do servidor; 50 bits; uso único com marcação atômica. |
| 10 | Média | Quem só tinha a senha (sem 2FA cadastrado) podia cadastrar o próprio autenticador. | Senha vazada = conta tomada no primeiro login. | Cadastro do 2FA exige também um **código enviado ao e-mail** da conta. Segredo TOTP guardado cifrado (AES-256-GCM); código TOTP não pode ser reutilizado. |
| 11 | Média | Tabela `audit_log` existia, mas nada gravava nela. | Sem rastro de quem alterou o quê. | Triggers de auditoria em 19 tabelas (antes/depois + usuário) e eventos de login/2FA/senha. O papel da aplicação **não pode** inserir, alterar nem apagar a auditoria. |
| 12 | Média | Sem CSP e sem cabeçalhos de segurança; cookie de sessão do Supabase legível por JavaScript. | XSS rouba sessão; clickjacking. | CSP com nonce por requisição (`script-src 'nonce-…' 'strict-dynamic'`), `frame-ancestors 'none'`, `X-Frame-Options`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, `Cache-Control: no-store`, HSTS no Nginx. Cookie `__Host-` HttpOnly, Secure, SameSite=Lax, com só o hash no banco. |
| 13 | Média | Webhook da Pluggy (removido em jul/2026, commit `3c963f6`) aceitava POST **sem nenhuma autenticação** e usava a chave `service_role`. | Enquanto existiu, qualquer um disparava sincronizações/alterava status de conexões. | Já não existe no código. Ação manual: apagar o webhook no painel da Pluggy e revogar as credenciais. Não há rotas `/api` nesta versão. |
| 14 | Baixa | Matrícula: aluno e matrícula em duas gravações separadas (idem importação). | Aluno "fantasma" sem plano após erro. | Mesma transação (importação: savepoint por linha). |
| 15 | Baixa | `markInvoicePaid` gravava o pagamento e depois o total em outra chamada. | Fatura paga com `total_paid` vazio. | Uma gravação. |
| 16 | Baixa | `updateStudent` alterava qualquer matrícula pelo id, sem conferir se era do aluno. | Alteração indevida por id manipulado. | Filtra por `student_id`. |
| 17 | Baixa | Tarefa recorrente: desmarcar e marcar de novo criava ocorrências duplicadas. | Lixo na agenda. | Só cria a próxima na primeira conclusão. |
| 18 | Baixa | Validação Zod parcial: datas como `string.min(1)`, parâmetros de URL sem validação, arrays sem limite nas actions de importação. | Erros 500, payloads gigantes. | Datas reais (`YYYY-MM-DD` válidas), limites de tamanho em todos os campos, máx. 1.000 alunos / 5.000 linhas de extrato por envio, ids `uuid`. |
| 19 | Baixa | Erro do provedor de IA repassado ao navegador. | Vazamento de detalhe interno. | Mensagem genérica; detalhe só no log. |

### Itens pedidos que não se aplicam a esta versão
- **Webhook da Pluggy autenticado:** a integração foi desligada em jul/2026; não há webhook (ver #13). Se voltar, a rota deve validar segredo/assinatura e ficar fora do `proxy` de sessão.
- **Exportações xlsx:** o sistema não exporta dados — o único `.xlsx` gerado é o **modelo em branco** de importação de alunos. Importar alunos exige `manage_invoices`; importar extrato, owner/sócio.
- **DRE:** não existe no código (etapa 7 "Contábil" do README nunca foi implementada). O mais próximo é o Relatório Anual, que foi testado.
- **Login com Google:** dependia do Supabase Auth e foi removido. Quem só entrava com Google usa "Esqueci minha senha" no primeiro acesso.

## 3. Como ficou a autorização (código **e** banco)

| Recurso | owner | sócio | funcionário |
|---|---|---|---|
| Ler alunos (com CPF), mensalidades, caixa, metas, indicadores | ✔ | ✔ | ✔ |
| Alunos, matrículas, mensalidades, lançamentos de caixa | permissão `manage_invoices` (os 3 papéis, pelo seed) | | |
| Planos, professores, categorias, metas | ✔ | ✔ | ✘ |
| Conciliação / importação de extrato | ✔ | ✔ | ✘ (redirecionado) |
| Lucro líquido no dashboard | ✔ | ✘ | ✘ |
| Ler auditoria, alterar perfis/papéis | ✔ | ✘ | ✘ |
| Tarefas | ✔ | ✔ | ✔ |

É **a mesma matriz que o RLS do Supabase aplicava** (não mudei regra de negócio). Ponto para você decidir: o seed descreve o funcionário como "sem dados financeiros sensíveis", mas o RLS sempre deu a ele leitura do fluxo de caixa completo e do CPF dos alunos. Se quiser restringir, é uma migration + ajuste em `policies.ts`.

**Defesa em profundidade (RLS mantido):** `auth.uid()` virou `app.current_user_id()` (= `current_setting('app.user_id')`), definido com `SET LOCAL` em cada transação (`withUser` em `src/lib/db/index.ts`). A aplicação conecta como `financeiro_app`, que não é dono das tabelas e não tem `BYPASSRLS`. Sem usuário definido (ex.: durante o login), nenhuma tabela de dados retorna linhas.

Limite conhecido: o RLS confia no `app.user_id` que o servidor define. Uma injeção de SQL no app poderia trocá-lo — por isso todas as consultas são parametrizadas (Drizzle/`sql\`\``, nenhuma concatenação de SQL), e as credenciais/2FA ficam no schema `iam`, separado.

## 4. Evidências
- `npm test`: 45 testes (TOTP com vetores da RFC 6238, bcrypt legado/scrypt, cifra, CSRF, matriz de papéis e **RLS por papel no Postgres real**).
- Teste ponta a ponta no build de produção atrás de HTTPS (24/24): ver resumo da entrega.
