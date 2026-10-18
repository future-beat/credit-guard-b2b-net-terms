import { WebhookValidationErrorReason } from "@shopify/shopify-api";
import { validateWebhook } from "../shopify.server";

/**
 * HMAC verification for the two webhook routes that must NOT load a session:
 * `app/routes/webhooks.compliance.tsx` and
 * `app/routes/webhooks.app.uninstalled.tsx` (WINDOWS #31).
 *
 * Why not `authenticate.webhook`: the library authenticator does exactly what
 * this function does — 405 / 401 / 400 in this order — and then calls
 * `ensureValidOfflineSession`, which refreshes an expired offline token before
 * the handler runs. `refreshToken()` collapses almost every failure into a bare
 * `Response(500)`, so for a store that vanished without an `app/uninstalled`
 * (a reviewer store that was deleted, say) the refresh fails forever: every
 * `shop/redact` retry answers 500 and the store's data is never redacted. That
 * is a live GDPR failure, and it is the only reason this module exists.
 *
 * Everything else is a byte-for-byte mirror of the library authenticator
 * (authenticate.mjs), deliberately:
 *
 *   - non-POST                       -> 405 Method not allowed
 *   - `request.text()` read ONCE, before validation (the signature is computed
 *     over the raw body; `request.json()` would consume it)
 *   - invalid HMAC                   -> 401 Unauthorized, thrown before a
 *     single statement with a side effect runs (threat T-01-10)
 *   - any other invalid result       -> 400 Bad Request
 *
 * The comparison itself is never hand-rolled: `validateWebhook` in
 * shopify.server.ts is the library's own `validateHmacFromRequestFactory`,
 * which is timing-safe. A forged `shop/redact` is a data-destruction
 * primitive, so that is the one thing in this file that must not be clever.
 */
export async function validateWebhookRequest(request: Request): Promise<{
  shop: string;
  topic: string;
  webhookId: string;
  apiVersion: string;
}> {
  if (request.method !== "POST") {
    throw new Response(undefined, {
      status: 405,
      statusText: "Method not allowed",
    });
  }

  const rawBody = await request.text();
  const check = await validateWebhook({ rawBody, rawRequest: request });

  if (!check.valid) {
    if (check.reason === WebhookValidationErrorReason.InvalidHmac) {
      throw new Response(undefined, { status: 401, statusText: "Unauthorized" });
    }
    throw new Response(undefined, { status: 400, statusText: "Bad Request" });
  }

  return {
    shop: check.domain,
    topic: check.topic,
    webhookId: check.webhookId,
    apiVersion: check.apiVersion,
  };
}
