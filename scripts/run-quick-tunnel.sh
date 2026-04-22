#!/bin/sh
# Handoff note for Mr. Smith:
# - File: `scripts/run-quick-tunnel.sh`
# - What this is: Operational shell script.
# - What it does: Automates deploy/tunnel/backup/restore runbook tasks.
# - Connections: Executed from terminal or automation; touches infra/data paths directly.
# - Main content type: Ops orchestration logic.
# - Safe edits here: User-facing messages and safe default notes.
# - Be careful with: Env vars, target hosts/paths, and potentially destructive commands.
# - Useful context: Treat as code-runbook: verify target environment every run.
# - Practical note: For simple copy/layout edits, this file is usually safe as long as you keep data contracts intact.

PORT="${1:-4000}"
CLOUDFLARED_BIN="${CLOUDFLARED_BIN:-cloudflared}"

exec "$CLOUDFLARED_BIN" tunnel --loglevel info --url "http://localhost:${PORT}"
