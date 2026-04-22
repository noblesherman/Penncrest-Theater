#!/usr/bin/env bash
# Handoff note for Mr. Smith:
# - File: `scripts/backup-postgres.sh`
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
PG_DUMP_BIN="${PG_DUMP_BIN:-pg_dump}"
OPENSSL_BIN="${OPENSSL_BIN:-openssl}"
RCLONE_BIN="${RCLONE_BIN:-rclone}"
DRY_RUN=0
SKIP_UPLOAD=0

usage() {
  cat <<EOF
Usage: $(basename "$0") [--dry-run] [--skip-upload] [--app-env-file PATH] [--backup-env-file PATH]

Creates a PostgreSQL backup using DATABASE_URL from the app env file.
If BACKUP_RCLONE_REMOTE is configured, the backup is uploaded with rclone.
EOF
}

log() {
  printf '[backup] %s\n' "$*"
}

fail() {
  printf '[backup] ERROR: %s\n' "$*" >&2
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

run_cmd() {
  if [ "$DRY_RUN" -eq 1 ]; then
    printf '[backup] dry-run:'
    local arg
    for arg in "$@"; do
      if [[ "$arg" == --dbname=* ]]; then
        printf ' %q' '--dbname=[redacted]'
      else
        printf ' %q' "$arg"
      fi
    done
    printf '\n'
    return 0
  fi

  "$@"
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --dry-run)
      DRY_RUN=1
      ;;
    --skip-upload)
      SKIP_UPLOAD=1
      ;;
    --app-env-file)
      shift
      [ "$#" -gt 0 ] || fail "--app-env-file requires a path"
      APP_ENV_FILE="$1"
      ;;
    --backup-env-file)
      shift
      [ "$#" -gt 0 ] || fail "--backup-env-file requires a path"
      BACKUP_ENV_FILE="$1"
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

load_env_file "$APP_ENV_FILE"
load_env_file "$BACKUP_ENV_FILE"

[ -n "${DATABASE_URL:-}" ] || fail "DATABASE_URL is not set. Checked $APP_ENV_FILE"
PG_DUMP_DATABASE_URL="$(sanitize_database_url "$DATABASE_URL")"

BACKUP_OUTPUT_DIR="${BACKUP_OUTPUT_DIR:-$ROOT_DIR/backups/postgres}"
BACKUP_OUTPUT_DIR="$(resolve_path "$BACKUP_OUTPUT_DIR")"
BACKUP_FILENAME_PREFIX="${BACKUP_FILENAME_PREFIX:-theater-db}"
BACKUP_KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"
BACKUP_REMOTE_KEEP_DAYS="${BACKUP_REMOTE_KEEP_DAYS:-30}"

if [ -n "${BACKUP_ENCRYPT:-}" ]; then
  BACKUP_ENCRYPT="${BACKUP_ENCRYPT}"
elif [ -n "${BACKUP_RCLONE_REMOTE:-}" ]; then
  BACKUP_ENCRYPT=1
else
  BACKUP_ENCRYPT=0
fi

require_cmd "$PG_DUMP_BIN"

if [ "$BACKUP_ENCRYPT" = "1" ]; then
  require_cmd "$OPENSSL_BIN"
  [ -n "${BACKUP_OPENSSL_PASSPHRASE:-}" ] || fail "BACKUP_OPENSSL_PASSPHRASE is required when BACKUP_ENCRYPT=1"
fi

if [ -n "${BACKUP_RCLONE_REMOTE:-}" ] && [ "$SKIP_UPLOAD" -eq 0 ]; then
  require_cmd "$RCLONE_BIN"
  [ -n "${BACKUP_RCLONE_PATH:-}" ] || fail "BACKUP_RCLONE_PATH is required when BACKUP_RCLONE_REMOTE is set"
fi

mkdir -p "$BACKUP_OUTPUT_DIR"

TIMESTAMP="$(date -u +"%Y%m%dT%H%M%SZ")"
BASE_NAME="${BACKUP_FILENAME_PREFIX}-${TIMESTAMP}"
RAW_DUMP_FILE="$BACKUP_OUTPUT_DIR/${BASE_NAME}.dump"
FINAL_FILE="$RAW_DUMP_FILE"

log "Writing backup to $BACKUP_OUTPUT_DIR"
if [ "$PG_DUMP_DATABASE_URL" != "$DATABASE_URL" ]; then
  log "Ignoring Prisma-only connection parameters for pg_dump"
fi
run_cmd "$PG_DUMP_BIN" \
  --dbname="$PG_DUMP_DATABASE_URL" \
  --format=custom \
  --no-owner \
  --no-privileges \
  --file="$RAW_DUMP_FILE"

if [ "$BACKUP_ENCRYPT" = "1" ]; then
  ENCRYPTED_FILE="${RAW_DUMP_FILE}.enc"
  log "Encrypting backup"
  run_cmd "$OPENSSL_BIN" enc -aes-256-cbc -pbkdf2 -salt \
    -in "$RAW_DUMP_FILE" \
    -out "$ENCRYPTED_FILE" \
    -pass env:BACKUP_OPENSSL_PASSPHRASE

  if [ "$DRY_RUN" -eq 0 ]; then
    rm -f "$RAW_DUMP_FILE"
  fi
  FINAL_FILE="$ENCRYPTED_FILE"
fi

if command -v shasum >/dev/null 2>&1 || command -v sha256sum >/dev/null 2>&1; then
  CHECKSUM_FILE="${FINAL_FILE}.sha256"
  if [ "$DRY_RUN" -eq 1 ]; then
    if command -v shasum >/dev/null 2>&1; then
      log "dry-run: shasum -a 256 $(basename "$FINAL_FILE") > $(basename "$CHECKSUM_FILE")"
    else
      log "dry-run: sha256sum $(basename "$FINAL_FILE") > $(basename "$CHECKSUM_FILE")"
    fi
  else
    if command -v shasum >/dev/null 2>&1; then
      shasum -a 256 "$FINAL_FILE" > "$CHECKSUM_FILE"
    else
      sha256sum "$FINAL_FILE" > "$CHECKSUM_FILE"
    fi
  fi
fi

if [ -n "${BACKUP_RCLONE_REMOTE:-}" ] && [ "$SKIP_UPLOAD" -eq 0 ]; then
  REMOTE_TARGET="${BACKUP_RCLONE_REMOTE}:${BACKUP_RCLONE_PATH}"
  log "Uploading backup to $REMOTE_TARGET"
  run_cmd "$RCLONE_BIN" copyto "$FINAL_FILE" "$REMOTE_TARGET/$(basename "$FINAL_FILE")"

  if [ -n "${CHECKSUM_FILE:-}" ]; then
    run_cmd "$RCLONE_BIN" copyto "$CHECKSUM_FILE" "$REMOTE_TARGET/$(basename "$CHECKSUM_FILE")"
  fi

  log "Pruning remote backups older than ${BACKUP_REMOTE_KEEP_DAYS} days"
  run_cmd "$RCLONE_BIN" delete "$REMOTE_TARGET" --min-age "${BACKUP_REMOTE_KEEP_DAYS}d"
  run_cmd "$RCLONE_BIN" rmdirs "$REMOTE_TARGET" --leave-root
fi

log "Pruning local backups older than ${BACKUP_KEEP_DAYS} days"
run_cmd find "$BACKUP_OUTPUT_DIR" -type f -name "${BACKUP_FILENAME_PREFIX}-*" -mtime +"$BACKUP_KEEP_DAYS" -delete

log "Backup complete: $(basename "$FINAL_FILE")"
