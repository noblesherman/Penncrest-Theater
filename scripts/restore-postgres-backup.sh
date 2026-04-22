#!/usr/bin/env bash
# Handoff note for Mr. Smith:
# - File: `scripts/restore-postgres-backup.sh`
# - What this is: Operational shell script.
# - What it does: Automates deploy/tunnel/backup/restore runbook tasks.
# - Connections: Executed from terminal or automation; touches infra/data paths directly.
# - Main content type: Ops orchestration logic.
# - Safe edits here: User-facing messages and safe default notes.
# - Be careful with: Env vars, target hosts/paths, and potentially destructive commands.
# - Useful context: Treat as code-runbook: verify target environment every run.
# - Practical note: For simple copy/layout edits, this file is usually safe as long as you keep data contracts intact.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_ENV_FILE="${APP_ENV_FILE:-$ROOT_DIR/backend/.env}"
BACKUP_ENV_FILE="${BACKUP_ENV_FILE:-$ROOT_DIR/.backup.env}"
PG_RESTORE_BIN="${PG_RESTORE_BIN:-pg_restore}"
OPENSSL_BIN="${OPENSSL_BIN:-openssl}"
RESTORE_FILE=""
TARGET_DATABASE_URL=""
YES_I_UNDERSTAND=0
DROP_PUBLIC_SCHEMA=0
SKIP_APP_ENV=0

usage() {
  cat <<EOF
Usage: $(basename "$0") --file PATH [--target-db-url URL] [--drop-public-schema] --yes-i-understand

Restores a PostgreSQL custom-format dump created by scripts/backup-postgres.sh.
Encrypted .enc backups are decrypted automatically using BACKUP_OPENSSL_PASSPHRASE.

Examples:
  npm run restore:db -- --file backups/postgres/theater-db-20260316T191022Z.dump.enc --yes-i-understand
  npm run restore:db -- --file /tmp/theater.dump --target-db-url postgresql://user:pass@localhost:5432/theater_restore --yes-i-understand
EOF
}

log() {
  printf '[restore] %s\n' "$*"
}

fail() {
  printf '[restore] ERROR: %s\n' "$*" >&2
  exit 1
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    fail "Missing required command: $1"
  fi
}

load_env_file() {
  local file="$1"

  if [ ! -f "$file" ]; then
    return 0
  fi

  # shellcheck disable=SC1090
  set -a && . "$file" && set +a
}

resolve_path() {
  local value="$1"

  if [[ "$value" = /* ]]; then
    printf '%s\n' "$value"
  else
    printf '%s\n' "$ROOT_DIR/${value#./}"
  fi
}

sanitize_database_url() {
  local url="$1"
  local base query part
  local cleaned_parts=()

  if [[ "$url" != *\?* ]]; then
    printf '%s\n' "$url"
    return 0
  fi

  base="${url%%\?*}"
  query="${url#*\?}"

  IFS='&' read -r -a query_parts <<< "$query"
  for part in "${query_parts[@]}"; do
    if [[ "$part" == schema=* ]] || [[ -z "$part" ]]; then
      continue
    fi
    cleaned_parts+=("$part")
  done

  if [ "${#cleaned_parts[@]}" -eq 0 ]; then
    printf '%s\n' "$base"
    return 0
  fi

  local joined_query=""
  for part in "${cleaned_parts[@]}"; do
    if [ -n "$joined_query" ]; then
      joined_query="${joined_query}&"
    fi
    joined_query="${joined_query}${part}"
  done

  printf '%s?%s\n' "$base" "$joined_query"
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --file)
      shift
      [ "$#" -gt 0 ] || fail "--file requires a path"
      RESTORE_FILE="$1"
      ;;
    --target-db-url)
      shift
      [ "$#" -gt 0 ] || fail "--target-db-url requires a value"
      TARGET_DATABASE_URL="$1"
      ;;
    --drop-public-schema)
      DROP_PUBLIC_SCHEMA=1
      ;;
    --skip-app-env)
      SKIP_APP_ENV=1
      ;;
    --yes-i-understand)
      YES_I_UNDERSTAND=1
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      fail "Unknown argument: $1"
      ;;
  esac
  shift
done

[ -n "$RESTORE_FILE" ] || fail "--file is required"
[ "$YES_I_UNDERSTAND" -eq 1 ] || fail "Restore is destructive. Re-run with --yes-i-understand"

if [ "$SKIP_APP_ENV" -eq 0 ]; then
  load_env_file "$APP_ENV_FILE"
fi
load_env_file "$BACKUP_ENV_FILE"

if [ -z "$TARGET_DATABASE_URL" ]; then
  TARGET_DATABASE_URL="${DATABASE_URL:-}"
fi

[ -n "$TARGET_DATABASE_URL" ] || fail "No target database URL found. Set DATABASE_URL or pass --target-db-url"

RESTORE_FILE="$(resolve_path "$RESTORE_FILE")"
[ -f "$RESTORE_FILE" ] || fail "Backup file not found: $RESTORE_FILE"

TARGET_DATABASE_URL="$(sanitize_database_url "$TARGET_DATABASE_URL")"

require_cmd "$PG_RESTORE_BIN"

TEMP_DIR="$(mktemp -d)"
cleanup() {
  rm -rf "$TEMP_DIR"
}
trap cleanup EXIT

INPUT_FILE="$RESTORE_FILE"
if [[ "$RESTORE_FILE" == *.enc ]]; then
  require_cmd "$OPENSSL_BIN"
  [ -n "${BACKUP_OPENSSL_PASSPHRASE:-}" ] || fail "BACKUP_OPENSSL_PASSPHRASE is required to decrypt .enc backups"

  INPUT_FILE="$TEMP_DIR/restore.dump"
  log "Decrypting backup into a temporary file"
  "$OPENSSL_BIN" enc -d -aes-256-cbc -pbkdf2 \
    -in "$RESTORE_FILE" \
    -out "$INPUT_FILE" \
    -pass env:BACKUP_OPENSSL_PASSPHRASE
fi

if [ "$DROP_PUBLIC_SCHEMA" -eq 1 ]; then
  log "Dropping and recreating public schema before restore"
  psql "$TARGET_DATABASE_URL" <<'SQL'
DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public;
SQL
fi

log "Restoring backup into PostgreSQL"
"$PG_RESTORE_BIN" \
  --clean \
  --if-exists \
  --no-owner \
  --dbname="$TARGET_DATABASE_URL" \
  "$INPUT_FILE"

log "Restore complete"
