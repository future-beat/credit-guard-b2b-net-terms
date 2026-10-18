#!/usr/bin/env bash
#
# Deployed smoke test for Credit Guard (plans 01-04 and 02-05,
# FOUND-01/FOUND-02/LEDG-02).
#
# Proves two things against the REAL deployed host, not a local server:
#   1. GET  /healthz              -> 200 over a valid TLS chain
#   2. every unauthenticated POST surface -> 401 when the HMAC is forged
#      (/webhooks/compliance, /webhooks/app/uninstalled, and the four Phase 2
#      ledger endpoints — six surfaces in all)
#
# Deliberately has NO error-suppressing fallbacks: every curl runs under
# `set -e` with its exit status propagating, so a DNS failure, a TLS failure or
# a hung connection fails the gate instead of being silently defaulted to a
# passing value. An error-suppressed gate measures nothing.
#
# Usage: scripts/smoke-deployed.sh app.creditguardhq.com
#
set -euo pipefail

HOST="${1:?usage: scripts/smoke-deployed.sh <host>   (e.g. app.creditguardhq.com)}"
BASE="https://${HOST}"
TIMEOUT="${SMOKE_TIMEOUT:-30}"

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

printf 'Smoke target: %s\n' "$BASE"

# --- 1. Health endpoint answers 200 over valid TLS -------------------------
# curl verifies the certificate chain by default (no -k anywhere in this file),
# so a bad chain is a nonzero exit, and ssl_verify_result is asserted as well.
health="$(curl -sS -o /dev/null -w '%{http_code} %{ssl_verify_result}' \
  --max-time "$TIMEOUT" "${BASE}/healthz")"
health_code="${health% *}"
health_tls="${health#* }"
printf '  GET  /healthz                     -> http=%s ssl_verify_result=%s\n' \
  "$health_code" "$health_tls"
[ "$health_code" = "200" ] || fail "/healthz returned ${health_code}, expected 200"
[ "$health_tls" = "0" ] || fail "TLS verification returned ${health_tls}, expected 0"

# --- 2. Forged HMAC is rejected with 401 -----------------------------------
# This is the exact case Shopify app review exercises (threat T-01-15): a POST
# shaped like a real delivery whose signature nobody could have produced.
# The shop domain is a throwaway that exists nowhere, so even a hypothetical
# handler execution would have nothing to act on.
forged_shop="${SMOKE_FORGED_SHOP:-smoke-forged-hmac.myshopify.com}"
forged_body="{\"shop_id\":0,\"shop_domain\":\"${forged_shop}\"}"
forged_code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time "$TIMEOUT" \
  -X POST "${BASE}/webhooks/compliance" \
  -H 'Content-Type: application/json' \
  -H 'X-Shopify-Topic: shop/redact' \
  -H "X-Shopify-Shop-Domain: ${forged_shop}" \
  -H 'X-Shopify-API-Version: 2026-07' \
  -H 'X-Shopify-Webhook-Id: smoke-forged-hmac' \
  -H 'X-Shopify-Hmac-Sha256: bm90LWEtdmFsaWQtaG1hYy1hdC1hbGw=' \
  -H "X-Shopify-Triggered-At: $(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --data-binary "$forged_body")"
printf '  POST /webhooks/compliance (forged) -> http=%s\n' "$forged_code"
[ "$forged_code" = "401" ] || fail "forged-HMAC POST returned ${forged_code}, expected 401"

# --- 3. The lifecycle endpoint rejects forged posts too ---------------------
# /webhooks/app/uninstalled is the other unauthenticated POST surface the app
# exposes, and it deactivates a shop. It must answer forged signatures the same
# way the compliance route does, or D-06 could be driven by anyone.
forged_uninstall_code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time "$TIMEOUT" \
  -X POST "${BASE}/webhooks/app/uninstalled" \
  -H 'Content-Type: application/json' \
  -H 'X-Shopify-Topic: app/uninstalled' \
  -H "X-Shopify-Shop-Domain: ${forged_shop}" \
  -H 'X-Shopify-API-Version: 2026-07' \
  -H 'X-Shopify-Webhook-Id: smoke-forged-uninstall' \
  -H 'X-Shopify-Hmac-Sha256: bm90LWEtdmFsaWQtaG1hYy1hdC1hbGw=' \
  -H "X-Shopify-Triggered-At: $(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --data-binary "{\"domain\":\"${forged_shop}\"}")"
printf '  POST /webhooks/app/uninstalled (forged) -> http=%s\n' "$forged_uninstall_code"
[ "$forged_uninstall_code" = "401" ] || fail "forged uninstall POST returned ${forged_uninstall_code}, expected 401"

# --- 4. The four Phase 2 ledger endpoints reject forged posts (T-02-24) -------
# These carry money. An unguarded one would let anyone rewrite a merchant's
# credit exposure — or, via a forged bulk_operations/finish, aim the app's own
# result download at an address of their choosing. Each is asserted separately
# rather than in a "one of them answered 401" loop, so a single unguarded route
# cannot hide behind its neighbours.
assert_forged_401() {
  endpoint="$1"
  topic="$2"
  body="$3"
  code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time "$TIMEOUT" \
    -X POST "${BASE}${endpoint}" \
    -H 'Content-Type: application/json' \
    -H "X-Shopify-Topic: ${topic}" \
    -H "X-Shopify-Shop-Domain: ${forged_shop}" \
    -H 'X-Shopify-API-Version: 2026-07' \
    -H "X-Shopify-Webhook-Id: smoke-forged-$(printf '%s' "$topic" | tr '/' '-')" \
    -H 'X-Shopify-Hmac-Sha256: bm90LWEtdmFsaWQtaG1hYy1hdC1hbGw=' \
    -H "X-Shopify-Triggered-At: $(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    --data-binary "$body")"
  printf '  POST %-26s (forged) -> http=%s\n' "$endpoint" "$code"
  [ "$code" = "401" ] || fail "forged POST to ${endpoint} returned ${code}, expected 401"
}

assert_forged_401 /webhooks/orders orders/create \
  '{"id":5001,"admin_graphql_api_id":"gid://shopify/Order/5001"}'
assert_forged_401 /webhooks/payment-terms payment_terms/update \
  '{"id":3001,"order_id":5001}'
assert_forged_401 /webhooks/companies companies/update \
  '{"id":1001,"admin_graphql_api_id":"gid://shopify/Company/1001"}'
# The url below is the SSRF probe the bulk route is built to ignore: a forged
# delivery must never get far enough for it to be read at all.
assert_forged_401 /webhooks/bulk-operations bulk_operations/finish \
  '{"admin_graphql_api_id":"gid://shopify/BulkOperation/7001","status":"completed","url":"http://169.254.169.254/latest/meta-data/"}'

printf 'PASS: healthz 200 over valid TLS, forged HMAC rejected with 401 on all six webhook endpoints\n'
