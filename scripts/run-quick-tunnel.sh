#!/bin/sh

PORT="${1:-4000}"
CLOUDFLARED_BIN="${CLOUDFLARED_BIN:-cloudflared}"

exec "$CLOUDFLARED_BIN" tunnel --loglevel info --url "http://localhost:${PORT}"
