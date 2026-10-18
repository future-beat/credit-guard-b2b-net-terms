#!/usr/bin/env bash
#
# Query the PRODUCTION database for one shop domain's lifecycle state.
#
# The production Postgres is only reachable from inside Railway's private
# network, so this ships scripts/prod-lifecycle-state.mjs into the running
# container over `railway ssh` and executes it there. DATABASE_URL is read from
# the container's own environment and never leaves it (threat T-01-16).
#
# Requires: railway CLI logged in, an SSH key registered (`railway ssh keys add`).
#
# Usage: scripts/prod-lifecycle-state.sh <shop-domain> [service]
#
set -euo pipefail

DOMAIN="${1:?usage: scripts/prod-lifecycle-state.sh <shop-domain> [service]}"
SERVICE="${2:-credit-guard-app}"
IDENTITY="${RAILWAY_SSH_KEY:-$HOME/.ssh/railway_ed25519}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# base64 is shell-safe, which keeps the remote command free of quoting hazards.
# The script must land inside /app, not /tmp: Node resolves `@prisma/client`
# from the directory tree of the file being executed, and node_modules lives in
# /app. It is removed again immediately after the query runs.
PAYLOAD="$(base64 < "${HERE}/prod-lifecycle-state.mjs" | tr -d '\n')"

railway ssh --service "$SERVICE" -i "$IDENTITY" \
  "printf %s '${PAYLOAD}' | base64 -d > /app/.prod-lifecycle-state.mjs && node /app/.prod-lifecycle-state.mjs '${DOMAIN}' && rm -f /app/.prod-lifecycle-state.mjs"
