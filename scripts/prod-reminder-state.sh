#!/usr/bin/env bash
#
# Read the PRODUCTION reminder state: applied migrations (by name), the
# ReminderLog table, the Shop.remindersEnabledAt switch, how many shops have
# reminders enabled, and the most recent reminder rows (plan 05-01+).
#
# Same access path — and the same reason — as scripts/prod-ledger-state.sh:
# production Postgres is only reachable from inside Railway's private network,
# so this ships scripts/prod-reminder-state.mjs into the running container over
# `railway ssh` and executes it there. DATABASE_URL never leaves Railway
# (threat T-02-22).
#
# READ-ONLY: the shipped script issues SELECTs only, and has no path that can
# enable reminders for a shop (D5-02 — the merchant's settings action is the
# only writer of that column).
#
# Requires: railway CLI logged in, an SSH key registered (`railway ssh keys add`)
# — see docs/RUNBOOK.md § Inspecting the production database for the one-time setup.
#
# Output is JSON on stdout and nothing else, so it pipes straight into jq:
#   scripts/prod-reminder-state.sh | jq '{migrations, enabled: .shops.remindersEnabled}'
#
# A third argument supplies a PROVISIONAL watermark (an ISO instant) for the
# touchpoint plan, so "which moment would send next, if reminders were enabled
# right now?" is answerable BEFORE the merchant flips the switch (plan 05-05
# LP-0). It is read-only in every sense: it changes no row, only the instant the
# plan is measured against.
#
# Usage: scripts/prod-reminder-state.sh [shop-domain] [service] [after-iso]
#
set -euo pipefail

DOMAIN="${1:-}"
SERVICE="${2:-credit-guard-app}"
AFTER="${3:-}"

# The remote command is assembled as a single-quoted shell string, so a quote or
# a backslash in an argument would break out of it. These are the only two args
# that reach it, and neither can legitimately contain a shell metacharacter.
for arg in "$DOMAIN" "$AFTER"; do
  if [[ -n "$arg" && ! "$arg" =~ ^[A-Za-z0-9._:+-]+$ ]]; then
    echo "refusing argument with unexpected characters: $arg" >&2
    exit 64
  fi
done

IDENTITY="${RAILWAY_SSH_KEY:-$HOME/.ssh/railway_ed25519}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# base64 is shell-safe, which keeps the remote command free of quoting hazards.
# The script must land inside /app, not /tmp: Node resolves `@prisma/client`
# from the directory tree of the file being executed, and node_modules lives in
# /app. It is removed again immediately after the query runs.
PAYLOAD="$(base64 < "${HERE}/prod-reminder-state.mjs" | tr -d '\n')"

railway ssh --service "$SERVICE" -i "$IDENTITY" \
  "printf %s '${PAYLOAD}' | base64 -d > /app/.prod-reminder-state.mjs && node /app/.prod-reminder-state.mjs '${DOMAIN}' ${AFTER:+--after '${AFTER}'} && rm -f /app/.prod-reminder-state.mjs"
