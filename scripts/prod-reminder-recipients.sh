#!/usr/bin/env bash
#
# Can this store's orders actually RECEIVE email? Prints, per order, every
# notification Shopify recorded on the timeline — order confirmations, invoices
# and `payment_reminder_sent` — as a per-run recipient FINGERPRINT plus the bare
# domain, never an address.
#
# Run this BEFORE asking a human to check an inbox. Plan 05-02 learned the hard
# way that `paymentReminderSend` returning `success: true` and the order timeline
# recording "Payment reminder email was sent to ..." are both perfectly
# compatible with nothing arriving, because Shopify's seeded sample customers
# live on `example.com` — a domain RFC 2606 reserves and which has no mail
# exchanger. `verdict.allRecipientsUndeliverable: true` is that situation named.
#
# Same access path as scripts/prod-reminder-state.sh: production Postgres and
# the shop's offline token exist only inside Railway's private network, so the
# script is shipped into the running container and executed there (T-02-22).
#
# READ-ONLY: Prisma finds and `Order.events` queries only — no mutation, so it
# cannot send a reminder while checking whether reminders can be received.
#
# Requires: railway CLI logged in, an SSH key registered (`railway ssh keys add`)
# — see docs/RUNBOOK.md § Inspecting the production database for the one-time setup.
#
# Output is JSON on stdout and nothing else:
#   scripts/prod-reminder-recipients.sh credit-guard-demo.myshopify.com | jq '.verdict'
#
# Usage: scripts/prod-reminder-recipients.sh <shop-domain> [service]
#
set -euo pipefail

DOMAIN="${1:?usage: scripts/prod-reminder-recipients.sh <shop-domain> [service]}"
SERVICE="${2:-credit-guard-app}"
IDENTITY="${RAILWAY_SSH_KEY:-$HOME/.ssh/railway_ed25519}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# base64 is shell-safe, which keeps the remote command free of quoting hazards.
# The script must land inside /app, not /tmp: Node resolves `@prisma/client`
# from the directory tree of the file being executed, and node_modules lives in
# /app. It is removed again immediately after the query runs.
PAYLOAD="$(base64 < "${HERE}/prod-reminder-recipients.mjs" | tr -d '\n')"

railway ssh --service "$SERVICE" -i "$IDENTITY" \
  "printf %s '${PAYLOAD}' | base64 -d > /app/.prod-reminder-recipients.mjs && node /app/.prod-reminder-recipients.mjs '${DOMAIN}' && rm -f /app/.prod-reminder-recipients.mjs"
