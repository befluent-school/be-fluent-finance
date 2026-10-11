#!/usr/bin/env bash
# ============================================================
# Backup diário do Be Fluent Finance: banco (pg_dump) + /var/lib/financeiro.
# Agende como usuário deploy:  crontab -e
#   15 3 * * * /var/www/financeiro/deploy/backup.sh >> /var/backups/financeiro/backup.log 2>&1
# Mantém 14 dias. IMPORTANTE: copie também para FORA da VPS (rclone) — se a
# VPS for perdida, o backup local vai junto. Os dumps têm CPF e dados
# financeiros: a cópia externa deve ser cifrada (BACKUP_GPG_RECIPIENT ou
# remote "crypt" do rclone).
# ============================================================
set -euo pipefail
umask 077

APP=/var/www/financeiro
DEST=/var/backups/financeiro
DATA=/var/lib/financeiro
STAMP=$(date +%Y-%m-%d_%H%M)

# Conexão do DONO do banco (não a da aplicação), guardada fora do código.
MIGRATION_DATABASE_URL=$(grep -E '^MIGRATION_DATABASE_URL=' "$APP/.env.admin" | cut -d= -f2- | tr -d '"')
BACKUP_GPG_RECIPIENT=$(grep -E '^BACKUP_GPG_RECIPIENT=' "$APP/.env.admin" | cut -d= -f2- | tr -d '"' || true)

mkdir -p "$DEST"
pg_dump --format=custom --no-owner --dbname="$MIGRATION_DATABASE_URL" > "$DEST/db_$STAMP.dump"
pg_restore --list "$DEST/db_$STAMP.dump" > /dev/null   # o arquivo é legível?

files=("db_$STAMP.dump")
if [ -d "$DATA" ] && [ -n "$(ls -A "$DATA" 2>/dev/null)" ]; then
  tar -czf "$DEST/dados_$STAMP.tar.gz" -C "$DATA" .
  files+=("dados_$STAMP.tar.gz")
fi

if [ -n "${BACKUP_GPG_RECIPIENT:-}" ]; then
  for f in "${files[@]}"; do
    gpg --batch --yes --encrypt --recipient "$BACKUP_GPG_RECIPIENT" --output "$DEST/$f.gpg" "$DEST/$f"
  done
fi

find "$DEST" -maxdepth 1 -name 'db_*.dump*' -mtime +14 -delete
find "$DEST" -maxdepth 1 -name 'dados_*.tar.gz*' -mtime +14 -delete

# Cópia externa (configure antes com: rclone config). Envie só os .gpg se usar GPG.
# rclone copy "$DEST" gdrive-crypt:backups/financeiro --max-age 25h --include '*.gpg'

echo "$(date -Is) backup ok: ${files[*]}"
