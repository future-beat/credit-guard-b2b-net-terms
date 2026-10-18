import * as Sentry from "@sentry/react-router";
import { SessionNotFoundError } from "@shopify/shopify-app-react-router/server";
import type { ActionFunctionArgs } from "react-router";

import { authenticate } from "../shopify.server";
import {
  type CompanyOrderHint,
  ingestOrderEvent,
  markWebhookProcessed,
  recordWebhookReceipt,
  recomputeCompany,
  releaseWebhookReceipt,
  removeOrder,
} from "../services/ledger.server";

/**
 * Order-shaped webhook ingest — the front door of the AR ledger (LEDG-02).
 *
 * `authenticate.webhook` is the FIRST statement and throws a 401 Response before
 * any line below runs (threat T-02-01). Never hand-roll that comparison and
 * never read the request body first — the library needs the raw signed body.
 *
 * THE PAYLOAD IS A DOORBELL (threat T-02-02). It is read for identifiers and
 * nothing else: no amount, status or date from it is ever believed or stored.
 * Money comes exclusively from the authenticated `OrderForLedger` refetch, so a
 * stale, reordered or replayed delivery still converges on current truth.
 *
 * The switch is deliberately topic-agnostic in effect: when `orders/updated` and
 * `orders/paid` fire within ~15 seconds Shopify may deliver only the former
 * (research Pitfall 3), so branching ledger behaviour on the topic name would
 * silently lose payments. Every order-shaped topic resolves an order gid and
 * calls the same refetch-and-recompute path.
 *
 * There is no session in scope — deliveries can arrive after uninstall
 * (research Pitfall 3), so the shop domain from the verified webhook is the only
 * key used.
 */

type WebhookPayload = Record<string, unknown>;

function numericGid(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return `gid://shopify/Order/${value}`;
  }
  if (typeof value === "string" && /^\d+$/.test(value)) {
    return `gid://shopify/Order/${value}`;
  }
  return null;
}

/**
 * Pull the ORDER gid out of a delivery.
 *
 * Two topics do not carry it at the top level: `refunds/create` is a refund
 * whose `admin_graphql_api_id` is a Refund gid (using it would refetch nothing),
 * and `orders/edited` wraps the order id inside `order_edit`.
 */
export function extractOrderGid(
  topic: string,
  payload: WebhookPayload,
): string | null {
  if (topic === "REFUNDS_CREATE") {
    return numericGid(payload.order_id);
  }

  if (topic === "ORDERS_EDITED") {
    const edit = payload.order_edit as WebhookPayload | undefined;
    const nested = numericGid(edit?.order_id);
    if (nested) return nested;
  }

  const adminGid = payload.admin_graphql_api_id;
  if (
    typeof adminGid === "string" &&
    adminGid.startsWith("gid://shopify/Order/")
  ) {
    return adminGid;
  }

  return numericGid(payload.id) ?? numericGid(payload.order_id);
}

function numericId(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string" && /^\d+$/.test(value)) return value;
  return null;
}

/**
 * The order payload's company reference — `company: { id, location_id }` on a
 * B2B order, absent otherwise. Still doorbell discipline (T-02-02/T-02-26): the
 * hint is an IDENTIFIER off a signed payload used only to pick which company's
 * authenticated order list the ladder scans; the attribution evidence is
 * Shopify's own company→orders edge, and a payload without the attribute (or
 * with a wrong one) simply degrades to the hint-less rung.
 */
export function payloadCompanyHint(
  payload: WebhookPayload,
): CompanyOrderHint | null {
  const company = payload.company;
  if (!company || typeof company !== "object") return null;

  const record = company as WebhookPayload;
  const companyId = numericId(record.id);
  if (!companyId) return null;

  const locationId = numericId(record.location_id);

  return {
    companyGid: `gid://shopify/Company/${companyId}`,
    companyLocationGid: locationId
      ? `gid://shopify/CompanyLocation/${locationId}`
      : null,
  };
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload, webhookId } =
    await authenticate.webhook(request);

  // At-least-once delivery: claim the id before doing any work, and treat a
  // losing claim as "already handled" (threat T-02-03). The ack is still 200 —
  // a redelivery is not an error and must not make Shopify retry forever.
  const claimed = await recordWebhookReceipt(webhookId, shop, topic);
  if (!claimed) {
    console.log(`Duplicate ${topic} delivery ${webhookId} for ${shop} — skipped`);
    return new Response();
  }

  const body = payload as WebhookPayload;
  const orderGid = extractOrderGid(topic, body);

  // The claim above is provisional until the work below succeeds. If anything
  // throws, the receipt is released and the error rethrown: Shopify sees a
  // non-200, redelivers, and that redelivery finds no receipt to be deduped
  // against. Without the release, a five-second Admin API blip would cost the
  // ledger that delivery outright — recoverable only by the daily reconciliation
  // (LEDG-04), which turns an instant correction into a ≤24h one on the path
  // that decides whether a merchant's customer is blocked at checkout.
  //
  // Unlike /webhooks/bulk-operations, this route has no poll fallback of its
  // own, so Shopify's retry IS the retry mechanism and must be kept usable.
  try {
    switch (topic) {
      case "ORDERS_CREATE":
      case "ORDERS_UPDATED":
      case "ORDERS_PAID":
      case "ORDERS_EDITED":
      case "ORDERS_CANCELLED":
      case "REFUNDS_CREATE": {
        if (!orderGid) {
          console.log(`No order id on ${topic} delivery ${webhookId} for ${shop}`);
          break;
        }
        await ingestOrderEvent(shop, orderGid, payloadCompanyHint(body));
        break;
      }

      case "ORDERS_DELETE": {
        // A deleted order cannot be refetched, so this is the one topic that
        // acts on its own: drop the row, then recompute the company it left
        // behind.
        if (!orderGid) break;
        const companyGid = await removeOrder(shop, orderGid);
        if (companyGid) await recomputeCompany(shop, companyGid);
        break;
      }

      default:
        // Unsubscribed topic routed here: acknowledge so Shopify stops retrying
        // a delivery we will never act on, but change nothing.
        console.log(`Unhandled order topic ${topic} for ${shop}`);
        break;
    }
  } catch (error) {
    // ACKNOWLEDGE-AND-DROP, ONE NAMED ERROR ONLY (WINDOWS #3).
    //
    // A post-uninstall delivery has no offline session to build an Admin client
    // from — the `app/uninstalled` handler already deleted it — so
    // `unauthenticated.admin(shop)` throws `SessionNotFoundError`. Releasing and
    // rethrowing here answers non-200 to a failure that is GUARANTEED to recur,
    // and Shopify then retries it for ~48h while recording 500s against the app
    // on a surface app review looks at. The receipt is marked PROCESSED instead,
    // so the redelivery dedupes; nothing is written to the ledger because the
    // shop is gone and D-06 retain-and-deactivate already holds its data.
    //
    // The check is on the CLASS, never on a message or a blanket catch: every
    // other error must keep releasing the claim and rethrowing (threat T-06-12,
    // the 02-03 claim-release contract), because for those Shopify's retry IS
    // the retry mechanism.
    //
    // Known and accepted (plan-check I-03): a delivery landing in the re-install
    // window — after the old session is deleted, before the new one is written —
    // is dropped the same way. The daily reconciliation (LEDG-04) re-derives it.
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
