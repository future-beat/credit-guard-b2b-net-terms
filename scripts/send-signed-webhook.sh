#!/usr/bin/env bash
#
# Send a VALIDLY SIGNED Shopify webhook to the deployed app (plan 01-04).
#
# Reproduces a real delivery header-for-header (the same header set as
# tests/helpers/webhook-hmac.ts) and signs the exact raw body with base64
# HMAC-SHA256, which is what @shopify/shopify-api verifies. Prints ONLY the
# HTTP status code on stdout so callers can assert on it.
#
# SECRET HANDLING (threat T-01-16): the client secret is read at runtime from
# the environment inside the signing process and is never assigned here, never
# passed as a command argument, and never printed. The digest is computed by
# node (which reads it from its own process environment) rather than by
# `openssl dgst -hmac <key>`, because openssl would place the secret in a
# process argument list visible to `ps`.
#
# Usage:
#   export SHOPIFY_API_SECRET=...   # e.g. piped from `railway variables`
#   scripts/send-signed-webhook.sh app.creditguardhq.com customers/data_request my-store.myshopify.com
#   scripts/send-signed-webhook.sh app.creditguardhq.com orders/create my-store.myshopify.com 5001
#
# Supported topics: customers/data_request, customers/redact, shop/redact,
# app/uninstalled, and the Phase 2 ledger topics orders/create, orders/updated,
# orders/delete and refunds/create (each routed to its own endpoint).
#
# The ledger bodies are DOORBELLS and nothing else: an id, and for a refund the
# order it belongs to. The deployed handler believes no amount, status or date
# from a payload — it refetches the order from the Admin API — so a fake order id
# here exercises the real code path including its not-found tolerance.
#
# The optional fourth argument is the numeric order id (default 5001).
#
set -euo pipefail

HOST="${1:?usage: scripts/send-signed-webhook.sh <host> <topic> <shop-domain> [order-id]}"
TOPIC="${2:?usage: scripts/send-signed-webhook.sh <host> <topic> <shop-domain> [order-id]}"
SHOP="${3:?usage: scripts/send-signed-webhook.sh <host> <topic> <shop-domain> [order-id]}"
ORDER_ID="${4:-5001}"

# Presence check only — expands to nothing and never assigns.
: "${SHOPIFY_API_SECRET:?must be exported in the environment before signing}"

API_VERSION="${SHOPIFY_WEBHOOK_API_VERSION:-2026-07}"
TIMEOUT="${WEBHOOK_TIMEOUT:-30}"

case "$TOPIC" in
  customers/data_request)
    ENDPOINT="/webhooks/compliance"
    BODY="{\"shop_id\":0,\"shop_domain\":\"${SHOP}\",\"orders_requested\":[],\"customer\":{\"id\":0,\"email\":\"\",\"phone\":\"\"},\"data_request\":{\"id\":0}}"
    ;;
  customers/redact)
    ENDPOINT="/webhooks/compliance"
    BODY="{\"shop_id\":0,\"shop_domain\":\"${SHOP}\",\"customer\":{\"id\":0,\"email\":\"\",\"phone\":\"\"},\"orders_to_redact\":[]}"
    ;;
  shop/redact)
    ENDPOINT="/webhooks/compliance"
    BODY="{\"shop_id\":0,\"shop_domain\":\"${SHOP}\"}"
    ;;
  app/uninstalled)
    ENDPOINT="/webhooks/app/uninstalled"
    BODY="{\"id\":0,\"name\":\"${SHOP}\",\"domain\":\"${SHOP}\",\"myshopify_domain\":\"${SHOP}\"}"
    ;;
  orders/create|orders/updated|orders/delete)
    ENDPOINT="/webhooks/orders"
    BODY="{\"id\":${ORDER_ID},\"admin_graphql_api_id\":\"gid://shopify/Order/${ORDER_ID}\"}"
    ;;
  refunds/create)
    # A refund's own admin_graphql_api_id is a Refund gid; the handler must read
    # order_id instead, which is exactly what this body checks.
    ENDPOINT="/webhooks/orders"
    BODY="{\"id\":88001,\"admin_graphql_api_id\":\"gid://shopify/Refund/88001\",\"order_id\":${ORDER_ID}}"
    ;;
  companies/create|companies/update|companies/delete)
    # The companies route makes no Admin API call — a company's name is not
    # money — so these deliveries prove the deployed route end to end on their
    # own. Use a throwaway shop domain and clean up with a signed shop/redact.
    ENDPOINT="/webhooks/companies"
    BODY="{\"id\":1001,\"admin_graphql_api_id\":\"gid://shopify/Company/1001\",\"name\":\"Deployed Probe Co\"}"
    ;;
  payment_terms/update)
    # Deliberately carries NO order reference: the correct deployed behaviour is
    # a 200 that defers to reconciliation rather than refetching some unrelated
    # order built from the PaymentTerms id.
    ENDPOINT="/webhooks/payment-terms"
    BODY="{\"id\":3001,\"admin_graphql_api_id\":\"gid://shopify/PaymentTerms/3001\",\"payment_terms_name\":\"Net 30\"}"
    ;;
  *)
    printf 'unsupported topic: %s\n' "$TOPIC" >&2
    exit 2
    ;;
esac

# Base64 HMAC-SHA256 over the EXACT bytes that will be sent. The body reaches
# node on stdin and the key reaches it via the inherited environment, so neither
# ever appears in an argument list.
HMAC="$(printf '%s' "$BODY" | node --input-type=module -e '
import { createHmac } from "node:crypto";
const chunks = [];
process.stdin.on("data", (c) => chunks.push(c));
process.stdin.on("end", () => {
  const key = process.env.SHOPIFY_API_SECRET;
  if (!key) {
    process.stderr.write("signing key missing from environment\n");
    process.exit(1);
  }
  process.stdout.write(createHmac("sha256", key).update(Buffer.concat(chunks)).digest("base64"));
});
')"

STATUS="$(curl -sS -o /dev/null -w '%{http_code}' --max-time "$TIMEOUT" \
  -X POST "https://${HOST}${ENDPOINT}" \
  -H 'Content-Type: application/json' \
  -H "X-Shopify-Topic: ${TOPIC}" \
  -H "X-Shopify-Shop-Domain: ${SHOP}" \
  -H "X-Shopify-API-Version: ${API_VERSION}" \
  -H "X-Shopify-Webhook-Id: cg-$(date -u +%Y%m%dT%H%M%SZ)-$$" \
  -H "X-Shopify-Hmac-Sha256: ${HMAC}" \
  -H "X-Shopify-Triggered-At: $(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --data-binary "$BODY")"

printf '%s\n' "$STATUS"
