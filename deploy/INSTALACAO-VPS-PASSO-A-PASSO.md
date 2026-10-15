# Instalação na VPS Hostinger (KVM) — passo a passo guiado

Guia para colocar o Be Fluent Finance no ar em `financeiro.befluentschool.com.br`,
numa VPS onde o **Beely já roda** (então Node/PostgreSQL/Nginx provavelmente já existem).

Tudo é feito pelo **Terminal do navegador** do hPanel:
hPanel → **VPS** → sua VPS (KVM 8) → **Terminal do navegador** (Browser terminal).

> Convenção: linhas começando com `$` são comandos para colar (sem o `$`).
> Depois de cada bloco, confira a saída antes de seguir.

---

## Fase 0 — Reconhecimento (o que já existe na VPS)

```
$ whoami
$ node -v ; npm -v
$ psql --version
$ nginx -v
$ pm2 -v
$ ls /var/www
```

Interpretação:
- `node -v` deve mostrar v22+ (se vier "command not found" ou v< 22, instalamos na Fase 1).
- `psql --version` 16+ esperado (o Beely provavelmente já trouxe o PostgreSQL).
- `nginx -v` e `pm2 -v` provavelmente já existem por causa do Beely.
- `/var/www` mostra onde ficam os sites (o Beely deve estar aí).

Anote o que falta. O resto do guia instala só o que estiver faltando.

---

## Fase 1 — Dependências que faltarem (pule as que já existem)

**Node 22** (se faltar ou estiver antigo):
```
$ curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
$ sudo apt-get install -y nodejs
$ node -v
```

**PM2** (gerenciador de processo, se faltar):
```
$ sudo npm install -g pm2
```

**Nginx** (se faltar):
```
$ sudo apt-get install -y nginx
```

**Git** (quase certo que já tem):
```
$ git --version || sudo apt-get install -y git
```

---

## Fase 2 — Baixar o código

```
$ sudo mkdir -p /var/www/financeiro
$ sudo chown -R $USER:$USER /var/www/financeiro
$ git clone -b vps-migration https://github.com/befluent-school/be-fluent-finance.git /var/www/financeiro
$ cd /var/www/financeiro
$ git log --oneline -1
```
Deve mostrar o commit `04d3c7d ... Plataforma financeira ...`.

---

## Fase 3 — Banco de dados (dois papéis)

Descubra a porta do PostgreSQL (o Beely pode usar a 5432 padrão):
```
$ sudo -u postgres psql -c "show port;"
```

Crie o banco e os dois papéis do financeiro (troque as DUAS senhas por senhas
fortes e **guarde-as**):
```
$ sudo -u postgres psql <<'SQL'
create role financeiro login password 'TROQUE_SENHA_DONO';
create role financeiro_app login password 'TROQUE_SENHA_APP' nosuperuser nocreatedb nocreaterole noinherit nobypassrls;
create database befluent_finance owner financeiro;
SQL
```

> `financeiro` é o dono (roda migrations). `financeiro_app` é o papel do app
> (sem BYPASSRLS — o RLS vale pra tudo). Os dois são exigidos pelo projeto.

---

## Fase 4 — Configuração (.env)

Gere dois segredos e anote:
```
$ openssl rand -hex 32    # vira APP_SECRET
$ openssl rand -hex 24    # vira CRON_SECRET
```

Arquivo da aplicação (`frontend/.env`):
```
$ nano /var/www/financeiro/frontend/.env
```
Cole (ajustando as senhas/segredos e a porta do Postgres se não for 5432):
```
DATABASE_URL="postgresql://financeiro_app:TROQUE_SENHA_APP@127.0.0.1:5432/befluent_finance"
APP_SECRET="<hex de 32 bytes gerado acima>"
NEXT_PUBLIC_APP_URL="https://financeiro.befluentschool.com.br"
TRUST_PROXY=1
SESSION_IDLE_HOURS=12
SESSION_MAX_DAYS=7
SMTP_HOST="smtp.hostinger.com"
SMTP_PORT=465
SMTP_USER="nao-responda@befluentschool.com.br"
SMTP_PASS="SENHA_DO_EMAIL"
EMAIL_FROM="Be Fluent Financeiro <nao-responda@befluentschool.com.br>"
ANTHROPIC_API_KEY=""
CRON_SECRET="<hex de 24 bytes gerado acima>"
CRON_USER_ID=""
BEELY_SOURCE=off
```
Salvar no nano: `Ctrl+O`, `Enter`, `Ctrl+X`. Depois:
```
$ chmod 600 /var/www/financeiro/frontend/.env
```

Arquivo do dono do banco (para migrations/backup), fora do app:
```
$ nano /var/www/financeiro/.env.admin
```
Cole:
```
MIGRATION_DATABASE_URL="postgresql://financeiro:TROQUE_SENHA_DONO@127.0.0.1:5432/befluent_finance"
```
Salvar e `chmod 600 /var/www/financeiro/.env.admin`.

---

## Fase 5 — Instalar, criar as tabelas e gerar o build

```
$ cd /var/www/financeiro/frontend
$ npm ci
$ npm run db:migrate
$ npm run build
```
`db:migrate` deve aplicar as migrations 0001→0028 e dizer quantas aplicou.
`build` deve terminar com a lista de rotas (inclui /impostos, /contas, /banco/conexoes).

---

## Fase 6 — Criar seu usuário e subir o serviço

```
$ cd /var/www/financeiro/frontend
$ npm run user -- create --email voce@befluentschool.com.br --name "Seu Nome" --role owner
$ npm run user -- list      # copie o ID do seu usuário owner
```
Cole esse ID no `.env` em `CRON_USER_ID=` (reabra com `nano ../frontend/.env`),
salve, e suba o serviço:
```
$ cd /var/www/financeiro
$ pm2 start deploy/ecosystem.config.cjs
$ pm2 save
$ pm2 status
```

---

## Fase 7 — DNS + Nginx + HTTPS

**DNS:** no hPanel → Domínios → `befluentschool.com.br` → Zona DNS, crie um
registro **A**: nome `financeiro`, valor = **IP da sua VPS** (aparece na página
da VPS no hPanel). Espere alguns minutos propagar.

**Nginx:** o projeto já traz a config pronta:
```
$ sudo cp /var/www/financeiro/deploy/nginx-financeiro.conf /etc/nginx/sites-available/financeiro
$ sudo ln -sf /etc/nginx/sites-available/financeiro /etc/nginx/sites-enabled/financeiro
$ sudo nginx -t && sudo systemctl reload nginx
```

**HTTPS (Let's Encrypt):**
```
$ sudo apt-get install -y certbot python3-certbot-nginx
$ sudo certbot --nginx -d financeiro.befluentschool.com.br
```
Siga as perguntas (e-mail, aceitar termos, redirect para HTTPS = sim).

Agora `https://financeiro.befluentschool.com.br` deve abrir a tela de login.

---

## Fase 8 — Automação (virada + sincronização bancária)

```
$ crontab -e
```
Adicione (troque SEU_SEGREDO pelo CRON_SECRET do .env):
```
# Backup diário às 3h15
15 3 * * * /var/www/financeiro/deploy/backup.sh >> /var/backups/financeiro/backup.log 2>&1
# Virada de mês + sincronização bancária, no minuto 5 de cada hora
5 * * * * curl -fsS -X POST -H "x-cron-secret: SEU_SEGREDO" https://financeiro.befluentschool.com.br/api/cron/sync >> /var/www/financeiro/cron.log 2>&1
```

---

## Fase 9 — Primeiro acesso e conexões bancárias

1. Acesse `https://financeiro.befluentschool.com.br`, faça login, configure o 2FA.
2. Menu **Conexões Bancárias** → cadastre ASAAS (API key) e Inter PJ (client_id,
   client_secret, certificado .crt e chave .key) → **Ativar** → **Sincronizar agora**.
3. Impostos/DAS você lança manualmente em **Contas a Pagar**.

---

## Ligar o CRM Beely depois (mesma VPS)

Quando quiser, crie um papel só-leitura no banco do Beely e ajuste o `.env`:
```
BEELY_SOURCE=postgres
BEELY_READONLY_DATABASE_URL="postgresql://financeiro_leitor:SENHA@127.0.0.1:5432/NOME_DO_BANCO_BEELY"
```
Aplique o contrato de views (`deploy/beely-views.sql`) como dono do banco do Beely,
e rode `npm run build && pm2 reload deploy/ecosystem.config.cjs --update-env`.

---

## Atualizações futuras (quando eu entregar novas versões)

```
$ bash /var/www/financeiro/deploy/update.sh
```
Faz backup → git pull → npm ci → migrations → build → reload, sem perder dados.
