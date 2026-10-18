import type { ActionFunctionArgs } from "react-router";
import { validateWebhookRequest } from "../services/webhook-validate.server";
import {
  logComplianceRequest,
  redactShop,
} from "../services/shop-lifecycle.server";

/**
 * The three mandatory GDPR compliance webhooks (FOUND-02). App review blocks
 * without them, and the template ships the subscription commented out — see the
 * `compliance_topics` block in shopify.app.toml, which points every topic here.
 *
 * `validateWebhookRequest` verifies the HMAC and THROWS a 401 Response before a
 * single line below runs (threat T-01-10); it also reads the raw body exactly
 * once, inside itself, because the signature is computed over those bytes.
 * Never hand-roll that comparison and never read `request.body` before it.
 *
 * It is deliberately NOT `authenticate.webhook`: the library authenticator
 * loads the offline session after the HMAC check and refreshes an expired
 * token before this handler runs, which 500s forever for a store that no
 * longer exists — so the store's data is never redacted (WINDOWS #31, fixed in
 * 1.0.1; see app/services/webhook-validate.server.ts).
 *
 * There is deliberately no session in scope — now literally, not just by
 * convention. `shop/redact` arrives 48 hours after uninstall, by which point no
 * session exists, so every operation here is keyed on the shop domain alone
 * (research Pitfall 3).
 *
 * Topic strings are the library's normalised form — the `X-Shopify-Topic` header
 * upper-cased with `/` and `.` replaced by `_` (`topicForStorage` in
 * @shopify/shopify-api). Assumption A1 confirmed against the library source.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await validateWebhookRequest(request);

  console.log(`Received ${topic} compliance webhook for ${shop}`);

  switch (topic) {
    case "CUSTOMERS_DATA_REQUEST":
      // Phase 1 stores no customer PII, so there is nothing to export and the
      // receipt IS the complete correct action. Becomes substantive in Phase 5,
      // when reminder-email logs start holding contact data.
      await logComplianceRequest(shop, topic);
      break;

    case "CUSTOMERS_REDACT":
      // Same rationale: nothing customer-scoped exists to delete yet. The
      // receipt is the 30-day audit trail that the request was actioned.
      await logComplianceRequest(shop, topic);
      break;

    case "SHOP_REDACT":
      // D-06 stage two: the merchant uninstalled 48 hours ago and their retained
      // data is now deleted for good. Idempotent — Shopify redelivers.
      await redactShop(shop);
      break;

    default:
      // Unsubscribed topic routed here: acknowledge so Shopify does not retry a
      // delivery we will never act on, but change nothing.
      console.log(`Unhandled compliance topic ${topic} for ${shop}`);
      break;
  }

  return new Response();
};
