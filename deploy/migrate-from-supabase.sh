#!/usr/bin/env bash
# ============================================================================
# Migra os DADOS do Supabase para o PostgreSQL da VPS.
#
#   SUPABASE_DB_URL='postgresql://postgres.<ref>:<SENHA>@aws-1-sa-east-1.pooler.supabase.com:5432/postgres' \
#     bash deploy/migrate-from-supabase.sh            # exporta, importa e confere
#   ... bash deploy/migrate-from-supabase.sh --export-only   (só baixa e confere o Supabase)
#
# Pré-requisitos (deploy/README.md):
#   - banco befluent_finance criado e com TODAS as migrations aplicadas
#     (npm run db:migrate) — o schema vem das migrations, do Supabase vêm só
#     os dados;
#   - cliente PostgreSQL 17 instalado (o Supabase roda PG 17):
#     sudo apt install postgresql-client-17   (repositório apt.postgresql.org)
#   - rodar na VPS como usuário deploy (a importação usa `sudo -u postgres`).
#
# O que faz:
#   1. confere se as tabelas/colunas do Supabase cabem no schema da VPS;
#   2. dump SÓ DE DADOS do schema public (sem mfa_backup_codes: o 2FA é
#      recadastrado) + exportação de auth.users (mesmos UUIDs + hash bcrypt);
#   3. importa tudo numa única transação (se algo falhar, nada fica pela
#      metade), com triggers desligados para preservar os valores originais
#      (updated_at, status) e sem poluir a auditoria;
#   4. confere chaves estrangeiras e imprime a contagem por tabela
#      (Supabase × VPS).
#
# Variáveis opcionais:
#   TARGET_ADMIN_URL  conexão de superusuário no destino (padrão: sudo -u postgres psql)
#   TARGET_DB         banco de destino (padrão: befluent_finance)
#   PG17_BIN          pasta do pg_dump 17 (padrão: /usr/lib/postgresql/17/bin)
#   OUT_DIR           onde guardar os arquivos (padrão: /var/backups/financeiro/supabase-<data>)
# ============================================================================
set -euo pipefail

MODE="${1:-full}"
: "${SUPABASE_DB_URL:?Defina SUPABASE_DB_URL (Supabase → Project Settings → Database → Connection string, modo Session)}"
TARGET_DB="${TARGET_DB:-befluent_finance}"
PG17_BIN="${PG17_BIN:-/usr/lib/postgresql/17/bin}"
STAMP="$(date +%Y-%m-%d_%H%M)"
OUT_DIR="${OUT_DIR:-/var/backups/financeiro/supabase-$STAMP}"

PG_DUMP="$PG17_BIN/pg_dump"
[ -x "$PG_DUMP" ] || PG_DUMP="$(command -v pg_dump)"
PSQL_SRC="$PG17_BIN/psql"
[ -x "$PSQL_SRC" ] || PSQL_SRC="$(command -v psql)"


target_psql() {
  if [ -n "${TARGET_ADMIN_URL:-}" ]; then
    psql -X -v ON_ERROR_STOP=1 "$@" --dbname="$TARGET_ADMIN_URL"
  else
    sudo -u postgres psql -X -v ON_ERROR_STOP=1 "$@" --dbname="$TARGET_DB"
  fi
}
# A conexão vai sempre por último, via --dbname (o psql do Windows ignora
# opções depois de um argumento posicional).
src_psql() { "$PSQL_SRC" -X -v ON_ERROR_STOP=1 "$@" --dbname="$SUPABASE_DB_URL"; }
mask() { sed -E 's#://([^:]+):[^@]*@#://\1:***@#'; }

echo "Origem : Supabase ($(echo "$SUPABASE_DB_URL" | mask))"
if [ -n "${TARGET_ADMIN_URL:-}" ]; then
  echo "Destino: $(echo "$TARGET_ADMIN_URL" | mask)"
else
  echo "Destino: banco $TARGET_DB (via sudo -u postgres)"
fi
echo "Arquivos: $OUT_DIR"
if [ "$MODE" != "--export-only" ] && [ "${ASSUME_YES:-}" != "1" ]; then
  echo
  echo "ATENÇÃO: os dados atuais do banco $TARGET_DB (tabelas public e iam) serão APAGADOS e substituídos."
  read -r -p "Digite MIGRAR para continuar: " answer
  [ "$answer" = "MIGRAR" ] || { echo "Cancelado."; exit 1; }
fi

umask 077
mkdir -p "$OUT_DIR"

dump_major="$("$PG_DUMP" --version | grep -oE '[0-9]+' | head -1)"
src_major="$(( $(src_psql -At -c 'show server_version_num') / 10000 ))"
if [ "$dump_major" -lt "$src_major" ]; then
  echo "pg_dump $dump_major não lê um servidor PostgreSQL $src_major. Instale postgresql-client-$src_major." >&2
  exit 1
fi

# ── 1. Estrutura: o que existe no Supabase precisa existir na VPS ────────────
echo "→ Conferindo tabelas e colunas…"
COLS_SQL="select table_name || '.' || column_name from information_schema.columns
          where table_schema = 'public' and table_name in (
            select table_name from information_schema.tables
             where table_schema = 'public' and table_type = 'BASE TABLE')
          order by 1"
src_psql -At -c "$COLS_SQL" | grep -v '^mfa_backup_codes\.' | tr -d '\r' | LC_ALL=C sort > "$OUT_DIR/colunas_supabase.txt"
target_psql -At -c "$COLS_SQL" | tr -d '\r' | LC_ALL=C sort > "$OUT_DIR/colunas_vps.txt"
missing="$(LC_ALL=C comm -23 "$OUT_DIR/colunas_supabase.txt" "$OUT_DIR/colunas_vps.txt" || true)"
if [ -n "$missing" ]; then
  echo "ERRO: colunas do Supabase que não existem na VPS (os dados se perderiam):" >&2
  echo "$missing" >&2
  echo "Crie uma migration para elas antes de migrar." >&2
  exit 1
fi
echo "  ok: todas as colunas do Supabase existem na VPS."

# ── 2. Exportação ───────────────────────────────────────────────────────────
echo "→ Baixando o schema public do Supabase (só para registro)…"
"$PG_DUMP" --schema-only --schema=public --no-owner --no-privileges --dbname="$SUPABASE_DB_URL" > "$OUT_DIR/schema_supabase.sql"

echo "→ Baixando os dados do schema public…"
"$PG_DUMP" --data-only --schema=public \
  --exclude-table=public.mfa_backup_codes --no-owner --no-privileges --dbname="$SUPABASE_DB_URL" \
  | grep -v -E '^SET transaction_timeout' > "$OUT_DIR/dados_public.sql"

echo "→ Exportando auth.users (mesmos UUIDs, hash bcrypt)…"
src_psql -c "\copy (
  select id, lower(btrim(email)) as email, nullif(encrypted_password, '') as encrypted_password,
         created_at, last_sign_in_at,
         (banned_until is not null and banned_until > now()) or deleted_at is not null as blocked,
         coalesce(raw_app_meta_data->>'provider', 'email') as provider
    from auth.users
   where email is not null
   order by created_at
) to '$OUT_DIR/auth_users.csv' with (format csv, header true)"

echo "→ Contando linhas na origem…"
src_psql -At -F ',' -c "
  select 'iam.users', count(*) from auth.users where email is not null
  union all
  select 'public.' || c.relname,
         (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from public.%I', c.relname), false, true, '')))[1]::text::bigint
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and c.relname <> 'mfa_backup_codes'
   order by 1" | tr -d '\r' > "$OUT_DIR/contagem_supabase.csv"

total_users=$(($(wc -l < "$OUT_DIR/auth_users.csv") - 1))
no_password=$(awk -F',' 'NR>1 && $3=="" {n++} END {print n+0}' "$OUT_DIR/auth_users.csv")
echo "  usuários: $total_users (sem senha — só Google: $no_password; vão usar \"Esqueci minha senha\")"
sha256sum "$OUT_DIR"/* > "$OUT_DIR/SHA256SUMS"

if [ "$MODE" = "--export-only" ]; then
  echo "Exportação concluída em $OUT_DIR (nada foi importado)."
  exit 0
fi

# ── 3. Importação (uma transação; triggers desligados) ──────────────────────
echo "→ Importando na VPS…"
target_psql -q <<SQL
set client_min_messages = warning;
begin;
set session_replication_role = replica;  -- preserva valores originais; sem triggers/auditoria

truncate table iam.auth_attempts, iam.password_reset_tokens, iam.sessions,
               iam.mfa_backup_codes restart identity cascade;
do \$\$
declare t text;
begin
  for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relkind = 'r'
  loop
    execute format('truncate table public.%I cascade', t);
  end loop;
end \$\$;
truncate table iam.users cascade;

create temp table supa_users (
  id uuid, email text, encrypted_password text, created_at timestamptz,
  last_sign_in_at timestamptz, blocked boolean, provider text
);
\copy supa_users from '$OUT_DIR/auth_users.csv' with (format csv, header true)
insert into iam.users (id, email, password_hash, created_at, updated_at, last_login_at)
select id, email, encrypted_password, created_at, now(), last_sign_in_at from supa_users;

\i '$OUT_DIR/dados_public.sql'

-- Usuário bloqueado/excluído no Supabase continua sem acesso.
update public.profiles p set active = false from supa_users s where s.id = p.id and s.blocked;

set session_replication_role = origin;

-- Integridade: nenhuma chave estrangeira órfã (os triggers de FK estavam desligados).
do \$\$
declare r record; orphans bigint;
begin
  for r in
    select con.conrelid::regclass as child, a.attname as col,
           con.confrelid::regclass as parent, af.attname as pcol
      from pg_constraint con
      join pg_attribute a on a.attrelid = con.conrelid and a.attnum = con.conkey[1]
      join pg_attribute af on af.attrelid = con.confrelid and af.attnum = con.confkey[1]
      join pg_namespace n on n.oid = (select relnamespace from pg_class where oid = con.conrelid)
     where con.contype = 'f' and n.nspname in ('public', 'iam') and array_length(con.conkey, 1) = 1
  loop
    execute format('select count(*) from %s c where c.%I is not null and not exists (select 1 from %s p where p.%I = c.%I)',
                   r.child, r.col, r.parent, r.pcol, r.col) into orphans;
    if orphans > 0 then
      raise exception 'FK órfã: %.% → % (% linhas)', r.child, r.col, r.parent, orphans;
    end if;
  end loop;
end \$\$;

insert into public.audit_log (action, table_name, new_data)
values ('auth.migrated_from_supabase', 'auth', jsonb_build_object('at', now()));
commit;
analyze;
SQL

# ── 4. Conferência ──────────────────────────────────────────────────────────
echo "→ Conferindo contagens…"
target_psql -At -F ',' -c "
  select 'iam.users', count(*) from iam.users
  union all
  select 'public.' || c.relname,
         (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from public.%I', c.relname), false, true, '')))[1]::text::bigint
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r'
   order by 1" | tr -d '\r' > "$OUT_DIR/contagem_vps.csv"

printf "\n%-40s %10s %10s  %s\n" "tabela" "supabase" "vps" "status"
fail=0
while IFS=',' read -r table src; do
  dst="$(grep -E "^${table}," "$OUT_DIR/contagem_vps.csv" | cut -d, -f2)"
  dst="${dst:-0}"
  expected="$src"
  # audit_log ganha 1 linha do registro da própria migração
  [ "$table" = "public.audit_log" ] && expected=$((src + 1))
  if [ "$dst" = "$expected" ]; then status="ok"; else status="DIFERENTE"; fail=1; fi
  printf "%-40s %10s %10s  %s\n" "$table" "$src" "$dst" "$status"
done < "$OUT_DIR/contagem_supabase.csv"

echo
if [ "$fail" = "0" ]; then
  echo "Migração concluída e conferida. Arquivos em $OUT_DIR"
  echo "Lembrete: todo usuário recadastra o 2FA no primeiro login (código enviado ao e-mail)."
else
  echo "ATENÇÃO: há contagens diferentes — investigue antes de trocar o DNS." >&2
  exit 2
fi
