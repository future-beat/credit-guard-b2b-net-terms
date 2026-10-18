import type { ActionFunctionArgs } from "react-router";

import { authenticate } from "../shopify.server";
import {
  markWebhookProcessed,
  recordWebhookReceipt,
} from "../services/ledger.server";

/**
 * `bulk_operations/finish` — a deliberate no-op since 02-07.
 *
 * The install backfill is company-driven (per-company pagination over the
 * authenticated `company(id){orders}` edge) and no longer submits bulk
 * operations, so there is nothing for a finish delivery to advance. The topic
 * STAYS in the live webhook registration — removing it would force a
 * registration deploy for zero gain — so this route must exist, keep
 * rejecting forged HMACs, and never throw (T-02-29).
 *
 * `authenticate.webhook` is the FIRST statement and throws a 401 Response
 * before any line below runs (threat T-02-12). Nothing in the payload is read
 * at all: the historical SSRF concern here (a payload-supplied result URL —
 * T-02-13) is retired by construction, because the route fetches nothing and
 * the backfill module no longer contains an outbound fetch.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, webhookId } = await authenticate.webhook(request);

  // At-least-once delivery: claim the id so a redelivery is a cheap skip.
  const claimed = await recordWebhookReceipt(webhookId, shop, topic);
  if (!claimed) {
    console.log(`Duplicate ${topic} delivery ${webhookId} for ${shop} — skipped`);
    return new Response();
  }

  console.log(
    `${topic} for ${shop} ignored — backfill is company-driven since 02-06/07`,
  );

  await markWebhookProcessed(webhookId);

  return new Response();
};
