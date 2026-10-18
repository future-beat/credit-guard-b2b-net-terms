#!/usr/bin/env bash
#
# Read the LIVE `$app`/`credit_v1` metafields back off the real Company records
# of one shop and compare them against the production database rows they
# project (plan 03-05 — the Phase 4 readiness gate).
#
# Same access path as scripts/prod-ledger-state.sh, and for the same two
# reasons: production Postgres is only reachable from inside Railway's private
# network, and the shop's offline access token lives only in that database. This
# ships scripts/prod-credit-metafields.mjs into the running container over
# `railway ssh` and executes it there, so neither DATABASE_URL nor the access
# token ever leaves Railway (threats T-02-22, T-03-12).
#
# Requires: railway CLI logged in, an SSH key registered (`railway ssh keys add`)
# — see docs/RUNBOOK.md § Inspecting the production database for the one-time setup.
#
# Output is JSON on stdout and nothing else, so it pipes straight into jq:
#   scripts/prod-credit-metafields.sh credit-guard-demo.myshopify.com \
#     | jq '.companies[] | {name, limit: .metafield.payload.limit, match}'
#
# Usage: scripts/prod-credit-metafields.sh <shop-domain> [service]
#
set -euo pipefail

DOMAIN="${1:?usage: scripts/prod-credit-metafields.sh <shop-domain> [service]}"
SERVICE="${2:-credit-guard-app}"
IDENTITY="${RAILWAY_SSH_KEY:-$HOME/.ssh/railway_ed25519}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# base64 is shell-safe, which keeps the remote command free of quoting hazards.
# The script must land inside /app, not /tmp: Node resolves `@prisma/client`
# from the directory tree of the file being executed, and node_modules lives in
# /app. It is removed again immediately after the query runs.
PAYLOAD="$(base64 < "${HERE}/prod-credit-metafields.mjs" | tr -d '\n')"

railway ssh --service "$SERVICE" -i "$IDENTITY" \
  "printf %s '${PAYLOAD}' | base64 -d > /app/.prod-credit-metafields.mjs && node /app/.prod-credit-metafields.mjs '${DOMAIN}' && rm -f /app/.prod-credit-metafields.mjs"
