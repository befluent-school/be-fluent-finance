# Plano de corte — Supabase/Render → VPS Hostinger

Roteiro para executar **manualmente**. Nada aqui foi executado. Tempo de indisponibilidade esperado: 15–30 min (sistema interno, poucos usuários).
Coordene a data com o corte do Beely CRM (o Financeiro lê dados dele): até o Beely migrar, use `BEELY_SOURCE=supabase`.

## D-7 a D-2 — preparação
1. VPS pronta conforme `deploy/README.md` §1–§5, §7–§8 (com o domínio de **ensaio**, ex. `financeiro-ensaio.befluentschool.com.br`).
2. Caixa de e-mail `nao-responda@…` criada na Hostinger; SMTP testado (`npm run user -- reset-link` + "Esqueci minha senha" no ensaio).
3. Cliente PostgreSQL 17 instalado na VPS (`postgresql-client-17`).
4. Inventário: anote a lista de usuários do Supabase (Auth → Users) e quem entra só com Google.

## D-2 — ensaio completo em subdomínio
1. `SUPABASE_DB_URL=… bash deploy/migrate-from-supabase.sh` no banco da VPS (dados reais, Render continua no ar).
2. Conferir o relatório de contagem (todas as linhas `ok`).
3. Com 1 usuário de cada papel: login com a senha antiga → código por e-mail → QR do 2FA → navegar por Mensalidades, Fluxo de Caixa, Conciliação, Relatório Anual, Dashboard. Comparar 3–4 números com o sistema atual (MRR, inadimplência, saldo do mês). Se houver mais de 1.000 lançamentos, os totais da VPS podem **divergir para melhor** (ver SEGURANCA.md #5).
4. Testar restauração de backup (`deploy/backup.sh` + `pg_restore` num banco de ensaio).

## D-1 — DNS
5. Baixar o TTL do registro do domínio final para **300 s** (pelo menos 24 h antes).
6. Avisar a equipe: janela de manutenção, e que no primeiro login cada um vai **recadastrar o 2FA** (código no e-mail + QR novo; o autenticador antigo "Be Fluent" pode ser apagado do celular depois) e anotar os novos códigos de backup. Quem entrava com Google usa "Esqueci minha senha".

## Dia D — janela de manutenção
7. No Render: suspender o serviço (ou colocar página de manutenção) — **ninguém grava mais no Supabase**.
8. Dump final + importação: `SUPABASE_DB_URL=… bash deploy/migrate-from-supabase.sh` (digite `MIGRAR`). O script apaga os dados do ensaio e importa de novo.
9. Conferência: relatório de contagem 100% `ok`; `npm run user -- list`; 2–3 números conferidos contra o passo 3.
10. `.env` de produção com `NEXT_PUBLIC_APP_URL=https://<domínio final>` → `npm run build` → `pm2 reload financeiro-web`.
11. Nginx: trocar `server_name` para o domínio final.
12. **Trocar o DNS** (registro A → IP da VPS).
13. `sudo certbot --nginx -d <domínio final>`; conferir HSTS no bloco 443.
14. Teste de fumaça no domínio final: login + 2FA, uma leitura e uma gravação simples.
15. Webhook da Pluggy: **não há mais webhook** — apagar o cadastrado no painel da Pluggy e revogar as credenciais (a integração foi desligada em jul/2026).
16. Guardar o diretório gerado pelo script (`/var/backups/financeiro/supabase-<data>`) — é o dump final da origem.

## D+1 a D+7 — monitoramento
17. `pm2 logs financeiro-web` diário; `/var/backups/financeiro/backup.log`; auditoria de logins: `select action, count(*) from audit_log where table_name='auth' and created_at > now() - interval '1 day' group by 1;`
18. Confirmar que todos os usuários recadastraram o 2FA (`npm run user -- list`, coluna `has_2fa`).
19. Render e Supabase continuam existindo, **só suspensos** (volta é possível revertendo o DNS — mas qualquer dado gravado na VPS nesse meio tempo teria de ser copiado de volta à mão).

## D+7 — desligar a origem
20. Render: excluir o serviço e as variáveis de ambiente (contêm `SUPABASE_SERVICE_ROLE_KEY`, Pluggy, Anthropic).
21. Supabase: baixar um dump final completo **fora da VPS** (ex. `pg_dump` local + cópia cifrada no Drive) e **pausar** o projeto.
22. Revogar a `ANTHROPIC_API_KEY` antiga.

## D+30
23. Excluir o projeto Supabase (depois de confirmar que o dump do passo 21 abre).

## Plano de volta (se algo der muito errado no Dia D)
Reverter o DNS para o Render e reativar o serviço. Como o TTL é 300 s, o retorno leva minutos. Só é limpo **antes** de alguém gravar dados na VPS.
