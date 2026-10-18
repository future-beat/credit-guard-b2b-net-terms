#!/usr/bin/env bash
#
# Read the LIVE App Pricing subscription state for one shop — exactly what
# `billing.check()` sees, and therefore exactly what the LNCH-01 gate in
# app/routes/app.tsx would decide (plan 06-04, empirical check E-1 in 06-06).
#
# Same access path — and the same two reasons — as
# scripts/prod-validation-state.sh: production Postgres is only reachable from
# inside Railway's private network, and the shop's offline access token lives
# only in that database. This ships scripts/prod-billing-state.mjs into the
# running container over `railway ssh` and executes it there, so neither
# DATABASE_URL nor the access token ever leaves Railway (threats T-02-22,
# T-03-12, T-04-18, T-06-17).
#
# READ-ONLY (T-04-17): the shipped script issues one find, one SELECT and one
# GraphQL query. It cannot create, cancel or alter a subscription.
#
# RUN THIS BEFORE THE GATE IS DEPLOYED. If `wouldPassGate` is false on a store
# that has already selected a plan, the deployed gate would bounce that merchant
# to Shopify's plan page on every load — the halt 06-06 carries.
#
# Requires: railway CLI logged in, an SSH key registered (`railway ssh keys add`)
# — see docs/RUNBOOK.md § Inspecting the production database for the one-time setup.
#
# Output is JSON on stdout and nothing else, so it pipes straight into jq:
#   scripts/prod-billing-state.sh credit-guard-demo.myshopify.com \
#     | jq '{wouldPassGate, subscriptions, pricingPlansUrl}'
#
# Usage: scripts/prod-billing-state.sh <shop-domain> [service]
#
set -euo pipefail

DOMAIN="${1:?usage: scripts/prod-billing-state.sh <shop-domain> [service]}"
SERVICE="${2:-credit-guard-app}"
IDENTITY="${RAILWAY_SSH_KEY:-$HOME/.ssh/railway_ed25519}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# base64 is shell-safe, which keeps the remote command free of quoting hazards.
# The script must land inside /app, not /tmp: Node resolves `@prisma/client`
# from the directory tree of the file being executed, and node_modules lives in
# /app. It is removed again immediately after the query runs.
PAYLOAD="$(base64 < "${HERE}/prod-billing-state.mjs" | tr -d '\n')"

railway ssh --service "$SERVICE" -i "$IDENTITY" \
  "printf %s '${PAYLOAD}' | base64 -d > /app/.prod-billing-state.mjs && node /app/.prod-billing-state.mjs '${DOMAIN}' && rm -f /app/.prod-billing-state.mjs"
