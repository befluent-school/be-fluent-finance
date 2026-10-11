#!/usr/bin/env bash
# ============================================================
# Publica uma nova versão do Be Fluent Finance (como usuário deploy):
#   bash /var/www/financeiro/deploy/update.sh
# Faz backup, baixa o código, instala, aplica migrations, gera o build
# e recarrega o processo sem perder dados.
# ============================================================
set -euo pipefail
cd /var/www/financeiro

bash deploy/backup.sh
git pull --ff-only
cd frontend
npm ci
npm run db:migrate          # usa MIGRATION_DATABASE_URL de ../.env.admin
npm run build               # NEXT_PUBLIC_APP_URL (frontend/.env) entra no build
cd ..
pm2 reload deploy/ecosystem.config.cjs --update-env
echo "Be Fluent Finance atualizado."
