import * as Sentry from "@sentry/react-router";
import { SessionNotFoundError } from "@shopify/shopify-app-react-router/server";
import type { ActionFunctionArgs } from "react-router";

import { authenticate } from "../shopify.server";
import {
  deleteCompany,
  markWebhookProcessed,
  recordWebhookReceipt,
  releaseWebhookReceipt,
  upsertCompany,
} from "../services/ledger.server";

/**
 * Company lifecycle webhook ingest (LEDG-01/LEDG-02).
 *
 * Keeps the local company head rows honest after the install backfill has run:
 * new companies appear without waiting for their first order, renames land, and
 * deletions are reflected.
 *
 * `authenticate.webhook` is the FIRST statement and throws a 401 Response before
 * any line below runs (threat T-02-07). The shop domain it returns is the ONLY
 * shop key used — never a value read out of a payload body — which is what keeps
 * one merchant's delivery from touching another's rows (threat T-02-11).
 *
 * THE PAYLOAD IS A DOORBELL for money, but a company's identity and name are not
 * money: there is no ledger amount to get wrong here, and no refetch is needed.
 * This route therefore never calls the Admin API. Exposure fields are untouched —
 * `recomputeCompany()` remains their single writer (ledger.server.ts rule 3).
 *
 * There is no session in scope — deliveries can arrive after uninstall.
 */

type WebhookPayload = Record<string, unknown>;

/** `admin_graphql_api_id` when it is a Company gid, else built from `id`. */
export function extractCompanyGid(payload: WebhookPayload): string | null {
  const adminGid = payload.admin_graphql_api_id;
  if (
    typeof adminGid === "string" &&
    adminGid.startsWith("gid://shopify/Company/")
  ) {
    return adminGid;
  }

  const id = payload.id;
  if (typeof id === "number" && Number.isFinite(id)) {
    return `gid://shopify/Company/${id}`;
  }
  if (typeof id === "string" && /^\d+$/.test(id)) {
    return `gid://shopify/Company/${id}`;
  }

  return null;
}

/**
 * The company's display name, or `null` when the payload carries none.
 *
 * NULL, NOT THE GID (03-05). `upsertCompany` still falls back to the gid when
 * it has to CREATE a row — the column is non-null and a recognisable gid beats
 * inventing a friendly-looking string — but a nameless delivery must never
 * rename a company that already has a good name. Shopify emits a real
 * `companies/update` with no `name` field moments after this app writes the
 * `credit_v1` metafield, and returning the gid here turned every credit publish
 * into a silent rename of the merchant's own company (measured live on
 * credit-guard-demo, 2026-08-19T17:43:34Z).
 */
function companyNameFrom(payload: WebhookPayload): string | null {
  const name = payload.name;
  return typeof name === "string" && name.trim().length > 0 ? name : null;
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload, webhookId } =
    await authenticate.webhook(request);

  // At-least-once delivery: claim the id before doing any work (threat T-02-10).
  const claimed = await recordWebhookReceipt(webhookId, shop, topic);
  if (!claimed) {
    console.log(`Duplicate ${topic} delivery ${webhookId} for ${shop} — skipped`);
    return new Response();
  }

  const body = payload as WebhookPayload;
  const companyGid = extractCompanyGid(body);

  // The claim is provisional until the work succeeds — see the identical guard
  // in webhooks.orders.tsx. A failed write here must leave Shopify's redelivery
  // able to do the work rather than be deduped away as already-seen.
  try {
    switch (topic) {
      case "COMPANIES_CREATE":
      case "COMPANIES_UPDATE": {
        if (!companyGid) {
          console.log(`No company id on ${topic} delivery ${webhookId} for ${shop}`);
          break;
        }
        await upsertCompany(shop, companyGid, companyNameFrom(body));
        break;
      }

      case "COMPANIES_DELETE": {
        // The company head row goes; its orders survive with `companyId = null`
        // (schema `onDelete: SetNull`). The order history is still true once the
        // company record is gone, and nothing null-keyed counts toward exposure.
        if (!companyGid) break;
        await deleteCompany(shop, companyGid);
        break;
      }

      default:
        // Unsubscribed topic routed here: acknowledge so Shopify stops retrying
        // a delivery we will never act on, but change nothing.
        console.log(`Unhandled company topic ${topic} for ${shop}`);
        break;
    }
  } catch (error) {
    // ACKNOWLEDGE-AND-DROP, ONE NAMED ERROR ONLY (WINDOWS #3) — the identical
    // branch in webhooks.orders.tsx carries the full rationale. A delivery for
    // an uninstalled shop has no offline session, so retrying it is guaranteed
    // to fail for ~48h while Shopify records 500s against the app; the receipt
    // is marked processed so the redelivery dedupes.
    //
    // This route does not call the Admin API today, so the branch is a uniform
    // property of the ingest surface rather than a live path here. It stays
    // because the rule must not depend on which queries a route happens to make
    // this month, and the source guard holds all three routes to it.
    //
    // Everything else keeps releasing the claim and rethrowing (T-06-12).
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
