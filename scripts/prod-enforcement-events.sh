#!/usr/bin/env bash
#
# Print the production EnforcementEvent log for one shop — the ENFC-05
# transition evidence (BLOCK_STATE_ENTERED / BLOCK_STATE_EXITED) and the ENFC-06
# leak evidence (BYPASSED_ORDER with its channel and pre-order snapshot), newest
# first, alongside each company's current enforcement state (plan 04-05).
#
# Same access path — and the same reason — as scripts/prod-ledger-state.sh:
# production Postgres is only reachable from inside Railway's private network,
# so DATABASE_URL never leaves Railway (threat T-02-22). This ships
# scripts/prod-enforcement-events.mjs into the running container over
# `railway ssh` and executes it there.
#
# READ-ONLY (T-04-17): the shipped script issues finds, counts and one groupBy.
# It makes NO Admin API call and reads no access token.
#
# Requires: railway CLI logged in, an SSH key registered (`railway ssh keys add`)
# — see docs/RUNBOOK.md § Inspecting the production database for the one-time setup.
#
# Output is JSON on stdout and nothing else, so it pipes straight into jq:
#   scripts/prod-enforcement-events.sh credit-guard-demo.myshopify.com \
#     | jq '.events[] | {kind, companyName, orderGid, channel, amount, createdAt}'
#
# Usage: scripts/prod-enforcement-events.sh <shop-domain> [max-rows] [service]
#
set -euo pipefail

DOMAIN="${1:?usage: scripts/prod-enforcement-events.sh <shop-domain> [max-rows] [service]}"
MAX_ROWS="${2:-200}"
SERVICE="${3:-credit-guard-app}"
IDENTITY="${RAILWAY_SSH_KEY:-$HOME/.ssh/railway_ed25519}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

case "$MAX_ROWS" in
  ''|*[!0-9]*)
    printf 'max-rows must be a positive integer, got: %s\n' "$MAX_ROWS" >&2
    exit 2
    ;;
esac

# base64 is shell-safe, which keeps the remote command free of quoting hazards.
# The script must land inside /app, not /tmp: Node resolves `@prisma/client`
# from the directory tree of the file being executed, and node_modules lives in
# /app. It is removed again immediately after the query runs.
PAYLOAD="$(base64 < "${HERE}/prod-enforcement-events.mjs" | tr -d '\n')"

railway ssh --service "$SERVICE" -i "$IDENTITY" \
  "printf %s '${PAYLOAD}' | base64 -d > /app/.prod-enforcement-events.mjs && node /app/.prod-enforcement-events.mjs '${DOMAIN}' '${MAX_ROWS}' && rm -f /app/.prod-enforcement-events.mjs"
