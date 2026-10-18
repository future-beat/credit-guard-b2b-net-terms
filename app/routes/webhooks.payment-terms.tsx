import * as Sentry from "@sentry/react-router";
import { SessionNotFoundError } from "@shopify/shopify-app-react-router/server";
import type { ActionFunctionArgs } from "react-router";

import { authenticate } from "../shopify.server";
import {
  markWebhookProcessed,
  recordWebhookReceipt,
  refetchOrderAndRecompute,
  releaseWebhookReceipt,
} from "../services/ledger.server";

/**
 * Payment-terms webhook ingest — the due-date half of the AR ledger (LEDG-02).
 *
 * WHY THIS ROUTE EXISTS SEPARATELY FROM `orders/*`: a merchant editing an order's
 * due date changes what "overdue" means for that company without necessarily
 * moving any money, and research found `orders/updated` is not guaranteed to fire
 * for it. `payment_terms/*` is the topic set that does (scope
 * `read_payment_terms`).
 *
 * `authenticate.webhook` is the FIRST statement and throws a 401 Response before
 * any line below runs (threat T-02-07). Never hand-roll that comparison and never
 * read the request body first — the library needs the raw signed body.
 *
 * THE PAYLOAD IS A DOORBELL (threat T-02-08). It is read for ONE identifier — the
 * owning order — and nothing else. The new due date is not taken from the
 * payload; it comes back from the authenticated `OrderForLedger` refetch, which
 * is why a stale or reordered delivery still converges on current truth.
 *
 * Every topic here funnels into the same `refetchOrderAndRecompute` as the
 * `orders/*` route. No ledger behaviour branches on the topic name: Shopify may
 * coalesce related deliveries (~15s window, research Pitfall 3), so a
 * topic-specific code path is a silent correctness hole waiting for a busy day.
 *
 * There is no session in scope — deliveries can arrive after uninstall, so the
 * shop domain from the verified webhook is the only key used.
 */

type WebhookPayload = Record<string, unknown>;

function orderGidFrom(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return `gid://shopify/Order/${value}`;
  }
  if (typeof value === "string" && /^\d+$/.test(value)) {
    return `gid://shopify/Order/${value}`;
  }
  if (
    typeof value === "string" &&
    value.startsWith("gid://shopify/Order/")
  ) {
    return value;
  }
  return null;
}

/**
 * Resolve the ORDER this payment-terms delivery is about.
 *
 * CRITICAL DIFFERENCE FROM THE ORDERS ROUTE: there is no `payload.id` fallback
 * here. On a `payment_terms/*` delivery `id` is the PaymentTerms id and
 * `admin_graphql_api_id` is a PaymentTerms gid — treating either as an order
 * would refetch `gid://shopify/Order/<terms id>`, which resolves to either
 * nothing or, far worse, an unrelated real order. Only fields that explicitly
 * name an order are trusted.
 *
 * The exact order-reference field is not verified against a live delivery yet
 * (02-05 wires the real subscriptions and can confirm), so every plausible
 * spelling Shopify uses across payload generations is accepted. Returning null is
 * a safe outcome: the caller acks and LEDG-04's daily reconciliation is the
 * universal backstop for anything the webhook surface misses.
 */
export function extractOrderGidFromTermsPayload(
  payload: WebhookPayload,
): string | null {
  const direct = orderGidFrom(payload.order_id);
  if (direct) return direct;

  const adminGid = payload.admin_graphql_api_id;
  if (
    typeof adminGid === "string" &&
    adminGid.startsWith("gid://shopify/Order/")
  ) {
    return adminGid;
  }

  const order = payload.order as WebhookPayload | undefined;
  if (order) {
    const nested =
      orderGidFrom(order.admin_graphql_api_id) ?? orderGidFrom(order.id);
    if (nested) return nested;
  }

  // PAYMENT_SCHEDULES_DUE nests the reference one level down in some payload
  // shapes. A bonus signal only — D-05 keeps the hourly sweep as the mechanism
  // of record for time-based overdue flips.
  const schedule = payload.payment_schedule as WebhookPayload | undefined;
  if (schedule) {
    const nested = orderGidFrom(schedule.order_id);
    if (nested) return nested;
  }

  return null;
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload, webhookId } =
    await authenticate.webhook(request);

  // At-least-once delivery: claim the id before doing any work, and treat a
  // losing claim as "already handled" (threat T-02-08/T-02-10). The ack is still
  // 200 — a redelivery is not an error and must not make Shopify retry forever.
  const claimed = await recordWebhookReceipt(webhookId, shop, topic);
  if (!claimed) {
    console.log(`Duplicate ${topic} delivery ${webhookId} for ${shop} — skipped`);
    return new Response();
  }

  const body = payload as WebhookPayload;

  // The claim is provisional until the work succeeds — see the identical guard
  // in webhooks.orders.tsx. A transient refetch failure here would otherwise let
  // the receipt dedupe Shopify's own redelivery away, silently costing a due-date
  // change until the daily reconciliation caught it.
  try {
    switch (topic) {
      case "PAYMENT_TERMS_CREATE":
      case "PAYMENT_TERMS_UPDATE":
      case "PAYMENT_TERMS_DELETE":
      case "PAYMENT_SCHEDULES_DUE": {
        const orderGid = extractOrderGidFromTermsPayload(body);
        if (!orderGid) {
          // Not an error: the payload simply did not name an order. The daily
          // reconciliation (LEDG-04) re-derives anything missed here.
          console.log(
            `No order reference on ${topic} delivery ${webhookId} for ${shop} — deferring to reconciliation`,
          );
          break;
        }
        await refetchOrderAndRecompute(shop, orderGid);
        break;
      }

      default:
        // Unsubscribed topic routed here: acknowledge so Shopify stops retrying
        // a delivery we will never act on, but change nothing.
        console.log(`Unhandled payment-terms topic ${topic} for ${shop}`);
        break;
    }
  } catch (error) {
    // ACKNOWLEDGE-AND-DROP, ONE NAMED ERROR ONLY (WINDOWS #3) — the identical
    // branch in webhooks.orders.tsx carries the full rationale. `refetchOrder-
    // AndRecompute` needs an Admin client, and a shop that has uninstalled has
    // no offline session to build one from: retrying is a guaranteed failure
    // Shopify would repeat for ~48h, recording 500s against the app. The receipt
    // is marked processed so the redelivery dedupes, and nothing is written.
    //
    // Everything else keeps releasing the claim and rethrowing (T-06-12) — a
    // transient refetch failure must still cost a redelivery, not a due date.
    if (error instanceof SessionNotFoundError) {
      await markWebhookProcessed(webhookId);
      Sentry.captureMessage(
        `${topic} delivery ${webhookId} for ${shop} dropped — no offline session (uninstalled); acknowledged so Shopify stops retrying`,
        "warning",
      );
      return new Response();
    }

    await releaseWebhookReceipt(webhookId);
    console.error(
      `${topic} delivery ${webhookId} for ${shop} failed — claim released for redelivery:`,
      error,
    );
    throw error;
  }

  await markWebhookProcessed(webhookId);

  return new Response();
};
