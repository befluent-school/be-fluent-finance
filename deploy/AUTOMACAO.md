# Automação — Virada de mês/ano

A virada gera, de forma **idempotente** (rodar de novo nunca duplica):

1. **Mensalidades** do mês de cada matrícula ativa.
2. **Contas a pagar recorrentes** do mês (contador, pró-labore, aluguel, SaaS…).
3. **DAS do Simples Nacional** da competência fechada (mês anterior), lançado
   como conta a pagar com vencimento no dia configurado (padrão: 20).
4. **Atualização de status** de mensalidades e contas vencidas (pendente → atrasado).

Tudo é feito por uma única função no banco, `public.run_monthly_rollover(...)`,
chamada de três formas — todas equivalentes:

- **Agendador do SO** (recomendado): `npm run rollover` (ver abaixo).
- **Botão "Rodar virada agora"** na tela **Automação** (owner/sócio).
- **Rede de segurança**: ao abrir qualquer tela, se ainda não rodou hoje, o app
  dispara a virada uma vez em segundo plano. Garante funcionamento mesmo sem
  agendador, mas o agendador continua sendo o caminho principal.

Liga/desliga e parâmetros (dia da geração, dia do DAS, Anexo) ficam em
**Automação → Configurações**.

---

## Windows (ambiente local da dona)

Agende para rodar todo dia de manhã. Um atalho pronto:

```powershell
# Em PowerShell, dentro de be-fluent-finance\frontend:
#   (ajuste o caminho se o projeto estiver em outro lugar)
$proj = "D:\INTELIGÊNCIA ARTIFICIAL\PLATAFORMAS\CONTROLE_FINANCEIRO_BE_FLUENT\be-fluent-finance\frontend"
schtasks /Create /TN "BeFluent-Virada" /SC DAILY /ST 08:00 /F `
  /TR "cmd /c cd /d `"$proj`" && npm run rollover >> `"$proj\..\rollover.log`" 2>&1"
```

Ou rode o script pronto (faz isso por você): `deploy\schedule-windows.ps1`.

Conferir / remover:

```powershell
schtasks /Query /TN "BeFluent-Virada"
schtasks /Delete /TN "BeFluent-Virada" /F
```

> O banco local (cluster na porta 5435) precisa estar no ar na hora agendada.
> Se a máquina ficar desligada, a virada roda na próxima vez que o app abrir
> (rede de segurança) ou na próxima execução agendada — e recupera os meses
> que faltaram.

---

## VPS Linux (produção)

Como usuário `deploy`, no diretório do projeto:

```bash
crontab -e
# Todo dia às 06:00 (horário do servidor):
0 6 * * * cd /opt/be-fluent-finance/frontend && /usr/bin/npm run rollover >> /opt/be-fluent-finance/rollover.log 2>&1
```

O `npm run rollover` lê `MIGRATION_DATABASE_URL` (dono do banco) do `.env` —
o mesmo usado pelas migrations. Não depende de nenhuma sessão de usuário.

---

## Sincronização bancária (ASAAS / Inter) em tempo real

As conexões bancárias são cadastradas na tela **Conexões Bancárias** (`/banco/conexoes`):
cole a API key do ASAAS e/ou o certificado + chave + client_id/secret do Inter PJ. As
credenciais ficam **cifradas** no banco (AES-256-GCM com `APP_SECRET`) — nunca em `.env`.

A sincronização busca entradas e saídas direto na API de cada banco e lança no Fluxo de
Caixa com dedupe (não duplica, mesmo que a transação também venha num extrato importado).
Ela roda de três formas:

1. **Oportunista** — ao abrir o app, se faz > 6 h desde a última sync (sem configurar nada).
2. **Botão "Sincronizar agora"** na tela de conexões.
3. **Agendador do SO** (recomendado, mais frequente) — chamando o endpoint interno
   `/api/cron/sync`, que roda a virada **e** a sincronização num passo só.

### Configurar o endpoint do cron

No `frontend/.env` (produção) ou `.env.local` (local):

```
CRON_SECRET="<openssl rand -hex 24>"
CRON_USER_ID="<uuid de um usuário owner/socio>"   # veja em public.profiles
```

Sem essas duas variáveis o endpoint fica inerte (responde 503).

### Agendar — VPS Linux (de hora em hora)

```bash
crontab -e
# Virada + sync bancária, no minuto 5 de cada hora:
5 * * * * curl -fsS -X POST -H "x-cron-secret: SEU_SEGREDO" https://financeiro.befluentschool.com.br/api/cron/sync >> /var/www/financeiro/cron.log 2>&1
```

> Mantém a linha diária do `npm run rollover` como reserva, se quiser — mas o `/api/cron/sync`
> já faz a virada, então não é obrigatório ter as duas.

### Agendar — Windows (de hora em hora)

```powershell
schtasks /Create /TN "BeFluent-Sync" /SC HOURLY /F `
  /TR "curl -fsS -X POST -H \"x-cron-secret: SEU_SEGREDO\" http://localhost:3000/api/cron/sync"
```

---

## Teste manual / recuperação

Forçar uma data específica (ex.: simular a virada de novembro):

```bash
npm run rollover -- 2026-11-01
```

O histórico de cada execução aparece em **Automação → Histórico de execuções**
e na tabela `public.job_runs`.
