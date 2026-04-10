#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_DIR="${ROOT_DIR}/backend"
ECOSYSTEM_FILE="${ROOT_DIR}/ecosystem.single.cjs"

BACKEND_PORT="${BACKEND_PORT:-6000}"
CLOUDFLARED_CONFIG="${CLOUDFLARED_CONFIG:-${ROOT_DIR}/cloudflared/config.yml}"
API_HEALTH_URL="${API_HEALTH_URL:-http://127.0.0.1:${BACKEND_PORT}/health}"

log() {
  printf '\n[%s] %s\n' "deploy-theater" "$1"
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

require_cmd npm
require_cmd pm2
require_cmd curl

if [ ! -f "${BACKEND_DIR}/.env" ]; then
  echo "Missing ${BACKEND_DIR}/.env" >&2
  exit 1
fi

if [ ! -f "${CLOUDFLARED_CONFIG}" ]; then
  echo "Missing cloudflared config: ${CLOUDFLARED_CONFIG}" >&2
  echo "Create it first (example: cp cloudflared/config.example.yml cloudflared/config.yml)." >&2
  exit 1
fi

log "Installing backend dependencies"
npm --prefix "${BACKEND_DIR}" ci --include=dev

log "Building backend"
npm --prefix "${BACKEND_DIR}" run build

log "Removing theater worker processes (single-process runtime)"
pm2 delete theater-checkout-worker theater-hold-cleanup theater-quick-tunnel >/dev/null 2>&1 || true

log "Restarting theater backend+tunnel with ${ECOSYSTEM_FILE}"
# NOTE: pm2 startOrRestart is flaky on some PM2 versions; delete+start is more portable.
pm2 delete theater-backend theater-tunnel >/dev/null 2>&1 || true
BACKEND_PORT="${BACKEND_PORT}" CLOUDFLARED_CONFIG="${CLOUDFLARED_CONFIG}" pm2 start "${ECOSYSTEM_FILE}" --update-env

log "Waiting for backend health check at ${API_HEALTH_URL}"
for attempt in {1..20}; do
  if curl -fsS "${API_HEALTH_URL}" >/dev/null 2>&1; then
    pm2 save
    log "Deploy successful"
    pm2 status
    exit 0
  fi
  sleep 1
done

echo "Backend health check failed: ${API_HEALTH_URL}" >&2
pm2 logs theater-backend --lines 120 --nostream || true
exit 1
