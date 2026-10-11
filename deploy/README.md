# Be Fluent Finance na VPS da Hostinger — passo a passo

Segue o padrão comum da VPS Be Fluent (`BEEFLOW/deploy/prompts/00-padrao-vps.md`):
Ubuntu 24.04, Node 22, PostgreSQL 16 local, Nginx + Certbot, PM2, usuário `deploy`, sem Docker.

```
Internet ──HTTPS──▶ Nginx (80/443) ──▶ Next.js 127.0.0.1:3300 (PM2: financeiro-web)
                                            │
                                            ├─▶ PostgreSQL local · banco befluent_finance
                                            │     papel financeiro_app (RLS)  ← aplicação
                                            │     papel financeiro (dono)     ← migrations/backup
                                            └─▶ banco beely_crm (papel financeiro_leitor, só SELECT em views)
```

| Item | Valor |
|---|---|
| Pasta | `/var/www/financeiro` |
| Processo PM2 | `financeiro-web` |
| Porta interna | `127.0.0.1:3300` |
| Banco | `befluent_finance` (dono `financeiro`, aplicação `financeiro_app`) |
| Dados em disco | `/var/lib/financeiro` (hoje vazio — o sistema não guarda arquivos) |
| Backups | `/var/backups/financeiro` |

Pré-requisito: o servidor já preparado pelo `setup-vps.sh` do BeeFlow (Node 22, PostgreSQL 16, Nginx, Certbot, PM2, UFW, fail2ban, usuário `deploy`).

## 1. Pastas
```bash
sudo mkdir -p /var/www/financeiro /var/lib/financeiro /var/backups/financeiro
sudo chown deploy:deploy /var/www/financeiro /var/lib/financeiro /var/backups/financeiro
sudo chmod 700 /var/lib/financeiro /var/backups/financeiro
```

## 2. Código
```bash
sudo -iu deploy
git clone git@github.com:befluent-school/be-fluent-finance.git /var/www/financeiro
cd /var/www/financeiro && git checkout vps-migration   # até o merge na main
```

## 3. Banco de dados (dois papéis — defesa em profundidade)
Gere duas senhas fortes (`openssl rand -base64 24`) e, como superusuário:
```bash
sudo -u postgres psql <<'SQL'
CREATE ROLE financeiro     LOGIN PASSWORD 'SENHA_DONO' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
CREATE ROLE financeiro_app LOGIN PASSWORD 'SENHA_APP'  NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT;
CREATE DATABASE befluent_finance OWNER financeiro ENCODING 'UTF8' TEMPLATE template0;
REVOKE ALL ON DATABASE befluent_finance FROM PUBLIC;
GRANT CONNECT ON DATABASE befluent_finance TO financeiro_app;
\c befluent_finance
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
ALTER SCHEMA public OWNER TO financeiro;
SQL
```
- `financeiro` é dono das tabelas: roda migrations e backups. **Não** vai no `.env` da aplicação.
- `financeiro_app` é o que o Next usa: não é dono de nada e não tem `BYPASSRLS`, então as policies de RLS valem para tudo o que a aplicação faz. A migration `0021` recusa rodar se esse papel tiver `SUPERUSER`/`BYPASSRLS`.
- A porta 5432 não é aberta no firewall.

**Leitura do Beely (quando o Beely estiver na VPS):**
```bash
sudo -u postgres psql -c "CREATE ROLE financeiro_leitor LOGIN PASSWORD 'SENHA_LEITOR' NOSUPERUSER NOBYPASSRLS;"
sudo -u postgres psql -d beely_crm -c "GRANT CONNECT ON DATABASE beely_crm TO financeiro_leitor;"
# como dono do beely_crm, aplique o contrato de views:
psql "postgresql://beely:...@127.0.0.1/beely_crm" -f deploy/beely-views.sql
```
Detalhes do que o Financeiro lê: [`beely-views.sql`](beely-views.sql).

## 4. Configuração
```bash
cp frontend/.env.example frontend/.env          # preencha (APP_SECRET: openssl rand -hex 32)
cp deploy/env.admin.example .env.admin          # MIGRATION_DATABASE_URL do papel financeiro
chmod 600 frontend/.env .env.admin
```
`NEXT_PUBLIC_APP_URL` entra no build: depois de mudar, rode o build de novo.

## 5. Instalar, criar as tabelas e gerar o build
```bash
cd /var/www/financeiro/frontend
npm ci
npm run db:migrate        # cria/atualiza o schema (db/migrations)
npm run build
```
Num banco vazio (sem migrar dados do Supabase), rode também o seed de permissões:
`psql "$MIGRATION_DATABASE_URL" -f ../db/seeds/0001_permissions_seed.sql` — os demais seeds são exemplos de desenvolvimento.

## 6. Dados do Supabase
Ver [`migrate-from-supabase.sh`](migrate-from-supabase.sh) e o plano de corte em [`PLANO-DE-CORTE.md`](PLANO-DE-CORTE.md).
O Supabase roda **PostgreSQL 17**: instale o cliente 17 na VPS (só o cliente; o servidor continua 16):
```bash
sudo apt install -y postgresql-client-17     # repositório apt.postgresql.org, já usado pelo PG 16
```

## 7. Subir o serviço (PM2)
```bash
cd /var/www/financeiro
pm2 start deploy/ecosystem.config.cjs
pm2 save
```
Logs: `pm2 logs financeiro-web` · Status: `pm2 status`.

## 8. Nginx + HTTPS
```bash
sudo cp deploy/nginx-financeiro.conf /etc/nginx/sites-available/financeiro
sudo nano /etc/nginx/sites-available/financeiro      # troque o domínio
sudo ln -s /etc/nginx/sites-available/financeiro /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d financeiro.befluentschool.com.br
```
Confira que a linha `Strict-Transport-Security` ficou dentro do bloco `listen 443` criado pelo certbot.

## 9. Usuários
Não há cadastro público. O owner gerencia pela linha de comando (na VPS):
```bash
cd /var/www/financeiro/frontend
npm run user -- list
npm run user -- create --email ana@befluentschool.com.br --name "Ana Souza" --role funcionario
npm run user -- reset-link --email ana@...     # novo link de senha (24 h, uso único)
npm run user -- reset-2fa  --email ana@...     # perdeu o celular E os códigos de backup
npm run user -- set-role   --email ana@... --role socio
npm run user -- deactivate --email ana@...     # bloqueia e encerra as sessões
```
Nenhuma senha passa pela linha de comando: o script imprime um link de uso único que você envia ao usuário por canal privado. Prefira **desativar** a excluir (o histórico de auditoria referencia o usuário).

**Primeiro acesso de cada usuário:** define/usa a senha → recebe por e-mail um código de 8 caracteres → escaneia o QR Code no app autenticador → guarda os 10 códigos de backup.

## 10. Backup automático (obrigatório)
```bash
chmod +x deploy/*.sh
crontab -e
15 3 * * * /var/www/financeiro/deploy/backup.sh >> /var/backups/financeiro/backup.log 2>&1
```
14 dias locais. **Configure a cópia externa cifrada** (rclone com remote `crypt`, ou `BACKUP_GPG_RECIPIENT` no `.env.admin`) — os dumps têm CPF e dados financeiros.

Restaurar (num banco vazio criado como no §3):
```bash
pg_restore --clean --if-exists --no-owner --role=financeiro -d "$MIGRATION_DATABASE_URL" /var/backups/financeiro/db_XXXX.dump
```
Teste a restauração uma vez por mês num banco de ensaio.

## 11. Automação: virada de mês + sincronização bancária (obrigatório para "tempo real")
Gere o segredo e descubra o id de um usuário owner/sócio:
```bash
openssl rand -hex 24                 # vira CRON_SECRET
cd /var/www/financeiro/frontend && npm run user -- list   # copie o id do owner
```
Acrescente em `frontend/.env` e rode `npm run build` + `pm2 reload`:
```
CRON_SECRET="<o hex gerado>"
CRON_USER_ID="<uuid do owner/socio>"
```
Agende o cron (de hora em hora) chamando o endpoint interno, que roda a virada **e** a sync bancária:
```bash
crontab -e
5 * * * * curl -fsS -X POST -H "x-cron-secret: SEU_SEGREDO" https://financeiro.befluentschool.com.br/api/cron/sync >> /var/www/financeiro/cron.log 2>&1
```
Depois, cadastre as contas em **Conexões Bancárias** (`/banco/conexoes`): API key do ASAAS e certificado/chave + client_id/secret do Inter PJ. Detalhes e alternativas: [AUTOMACAO.md](AUTOMACAO.md).

## Atualizar para uma nova versão
```bash
bash /var/www/financeiro/deploy/update.sh   # backup → git pull → npm ci → migrations → build → reload
```
A `update.sh` já aplica as migrations novas (0023–0028: contas a pagar, Simples/DAS, automação, conexões bancárias). Depois de atualizar, confira a seção 11 se ainda não tiver configurado o cron.

## Desenvolvimento local (Windows)
O PostgreSQL 16 da máquina (`C:\pgsql16\bin`, porta 5432) **não** é usado. O projeto tem um cluster próprio na porta 5435:
```bash
# uma vez
C:/pgsql16/bin/initdb -D .pgdata -U postgres -W --auth=scram-sha-256 --encoding=UTF8 --locale=C
# acrescente em .pgdata/postgresql.conf:  port = 5435   e   listen_addresses = '127.0.0.1'
# crie os papéis/banco como no §3 (porta 5435)
# sempre que for usar
C:/pgsql16/bin/pg_ctl -D .pgdata -l .pgdata/server.log start
cd frontend
npm run db:migrate && npm run db:seed
npm run user -- create --email voce@teste.local --name "Você" --role owner
npm run dev
```
`frontend/.env.development.local` (ignorado pelo git) guarda `DATABASE_URL`, `MIGRATION_DATABASE_URL`, `APP_SECRET`, `NEXT_PUBLIC_APP_URL=http://localhost:3000`. Sem SMTP, os e-mails (links e códigos) aparecem no terminal do `npm run dev`.

Testes: `npm test` (unitários + RLS no banco local — exigem o cluster 5435 rodando).
