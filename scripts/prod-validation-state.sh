#!/usr/bin/env bash
#
# Read the LIVE cart-and-checkout Validation back off one shop and compare it
# against the production `Shop.validationGid` row (plan 04-05, EC-4).
#
# Same access path — and the same two reasons — as
# scripts/prod-credit-metafields.sh: production Postgres is only reachable from
# inside Railway's private network, and the shop's offline access token lives
# only in that database. This ships scripts/prod-validation-state.mjs into the
# running container over `railway ssh` and executes it there, so neither
# DATABASE_URL nor the access token ever leaves Railway (threats T-02-22,
# T-03-12, T-04-18).
#
# READ-ONLY (T-04-17): the shipped script issues finds and GraphQL queries only.
#
# Requires: railway CLI logged in, an SSH key registered (`railway ssh keys add`)
# — see docs/RUNBOOK.md § Inspecting the production database for the one-time setup.
#
# Output is JSON on stdout and nothing else, so it pipes straight into jq:
#   scripts/prod-validation-state.sh credit-guard-demo.myshopify.com \
#     | jq '{ec4, a4: .a4.verdict, gid: .ours.id}'
#
# Usage: scripts/prod-validation-state.sh <shop-domain> [service]
#
set -euo pipefail

DOMAIN="${1:?usage: scripts/prod-validation-state.sh <shop-domain> [service]}"
SERVICE="${2:-credit-guard-app}"
IDENTITY="${RAILWAY_SSH_KEY:-$HOME/.ssh/railway_ed25519}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# base64 is shell-safe, which keeps the remote command free of quoting hazards.
# The script must land inside /app, not /tmp: Node resolves `@prisma/client`
# from the directory tree of the file being executed, and node_modules lives in
# /app. It is removed again immediately after the query runs.
PAYLOAD="$(base64 < "${HERE}/prod-validation-state.mjs" | tr -d '\n')"

railway ssh --service "$SERVICE" -i "$IDENTITY" \
  "printf %s '${PAYLOAD}' | base64 -d > /app/.prod-validation-state.mjs && node /app/.prod-validation-state.mjs '${DOMAIN}' && rm -f /app/.prod-validation-state.mjs"
