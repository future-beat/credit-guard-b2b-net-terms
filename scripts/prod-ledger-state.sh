#!/usr/bin/env bash
#
# Query the PRODUCTION database for one shop domain's AR-ledger state (plan
# 02-05): per-company exposures, ledger row counts, webhook receipts, the
# backfill/reconciliation cursors and the scheduler leases.
#
# Same access path as scripts/prod-lifecycle-state.sh, and for the same reason:
# production Postgres is only reachable from inside Railway's private network,
# so this ships scripts/prod-ledger-state.mjs into the running container over
# `railway ssh` and executes it there. DATABASE_URL is read from the container's
# own environment and never leaves it (threat T-02-22).
#
# Requires: railway CLI logged in, an SSH key registered (`railway ssh keys add`)
# — see docs/RUNBOOK.md § Inspecting the production database for the one-time setup.
#
# Output is JSON on stdout and nothing else, so it pipes straight into jq:
#   scripts/prod-ledger-state.sh credit-guard-demo.myshopify.com | jq '.ledger'
#
# Usage: scripts/prod-ledger-state.sh <shop-domain> [service]
#
set -euo pipefail

DOMAIN="${1:?usage: scripts/prod-ledger-state.sh <shop-domain> [service]}"
SERVICE="${2:-credit-guard-app}"
IDENTITY="${RAILWAY_SSH_KEY:-$HOME/.ssh/railway_ed25519}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# base64 is shell-safe, which keeps the remote command free of quoting hazards.
# The script must land inside /app, not /tmp: Node resolves `@prisma/client`
# from the directory tree of the file being executed, and node_modules lives in
# /app. It is removed again immediately after the query runs.
PAYLOAD="$(base64 < "${HERE}/prod-ledger-state.mjs" | tr -d '\n')"

railway ssh --service "$SERVICE" -i "$IDENTITY" \
  "printf %s '${PAYLOAD}' | base64 -d > /app/.prod-ledger-state.mjs && node /app/.prod-ledger-state.mjs '${DOMAIN}' && rm -f /app/.prod-ledger-state.mjs"
