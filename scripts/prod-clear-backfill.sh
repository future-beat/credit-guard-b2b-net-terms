#!/usr/bin/env bash
#
# Clear ONE shop's backfill cursor in the PRODUCTION database (plan 02-08), so
# the next embedded app-open re-runs the company-driven install backfill.
#
# Same access path as scripts/prod-ledger-state.sh, and for the same reason:
# production Postgres is only reachable from inside Railway's private network,
# so this ships scripts/prod-clear-backfill.mjs into the running container over
# `railway ssh` and executes it there. DATABASE_URL is read from the container's
# own environment and never leaves it (threat T-02-22).
#
# The write is scoped to exactly [shop, "backfill"] inside the .mjs — it never
# touches the reconciliation cursor, any other shop, or any other key
# (threat T-02-30). Before/after state is printed for the audit trail.
#
# Requires: railway CLI logged in, an SSH key registered (`railway ssh keys add`)
# — see docs/RUNBOOK.md § Inspecting the production database for the one-time setup.
#
# Output is JSON on stdout and nothing else, so it pipes straight into jq:
#   scripts/prod-clear-backfill.sh credit-guard-demo.myshopify.com | jq '.cleared'
#
# Usage: scripts/prod-clear-backfill.sh <shop-domain> [service]
#
set -euo pipefail

DOMAIN="${1:?usage: scripts/prod-clear-backfill.sh <shop-domain> [service]}"
SERVICE="${2:-credit-guard-app}"
IDENTITY="${RAILWAY_SSH_KEY:-$HOME/.ssh/railway_ed25519}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# base64 is shell-safe, which keeps the remote command free of quoting hazards.
# The script must land inside /app, not /tmp: Node resolves `@prisma/client`
# from the directory tree of the file being executed, and node_modules lives in
# /app. It is removed again immediately after the clear runs.
PAYLOAD="$(base64 < "${HERE}/prod-clear-backfill.mjs" | tr -d '\n')"

railway ssh --service "$SERVICE" -i "$IDENTITY" \
  "printf %s '${PAYLOAD}' | base64 -d > /app/.prod-clear-backfill.mjs && node /app/.prod-clear-backfill.mjs '${DOMAIN}' && rm -f /app/.prod-clear-backfill.mjs"
