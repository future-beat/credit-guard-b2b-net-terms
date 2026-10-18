/**
 * Answer one question about a store before anybody sends it a reminder: CAN
 * these orders receive email at all?
 *
 * Plan 05-02 sent three real `paymentReminderSend` calls that Shopify accepted
 * (`success: true`, no userErrors) and recorded on each order's timeline as
 * `payment_reminder_sent` — and not one of them arrived, because every customer
 * on the demo store is a Shopify sample contact on `example.com`, a domain
 * RFC 2606 reserves for documentation and which therefore has no mail exchanger.
 * A green API response is not delivery, and the gap between them cost a whole
 * verification round. This script closes it: it is the pre-send check that turns
 * "the contacts are our test inboxes" from a belief into a measurement.
 *
 * Runs INSIDE the Railway container (shipped there by
 * scripts/prod-reminder-recipients.sh) for the usual reason — the shop's offline
 * access token and `postgres.railway.internal` both exist only there
 * (threats T-02-22, T-03-12, T-04-18).
 *
 * READ-ONLY (T-04-17): one Prisma find for the order list, one `Order.events`
 * QUERY per order. There is no mutation in this file; it cannot send anything.
 *
 * IT NEVER LEARNS AN ADDRESS (T-05-07). Notification events name their
 * recipient in prose ("Payment reminder email was sent to ..."). Every
 * address matched in an event payload is immediately reduced to
 * `sha256(runSalt + address)` truncated to 12 hex characters, plus its bare
 * domain. That is enough to answer both questions that matter —
 *
 *   "did the reminder go to the SAME mailbox as the order confirmation?"
 *     -> compare fingerprints within this run
 *   "is that mailbox capable of receiving mail?"
 *     -> look at the domain
 *
 * — while the local part never leaves Shopify. The salt is random PER RUN, so
 * the fingerprints are deliberately NOT comparable across runs and cannot be
 * dictionary-attacked back into an address by anyone reading a saved output.
 *
 * The app has no customer scopes, so `Order.email`, `Order.customer` and
 * `Order.purchasingEntity` are all ACCESS_DENIED to it — deliberately (D5-01,
 * research Pitfall 5). This script does not reach for them; the timeline is a
 * merchant-facing surface that `read_orders` already covers.
 *
 * Usage (inside the container): node prod-reminder-recipients.mjs <shop-domain>
 */
import "@shopify/shopify-app-react-router/adapters/node";
import { createHash, randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import {
  ApiVersion,
  AppDistribution,
  shopifyApp,
} from "@shopify/shopify-app-react-router/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";

const domain = process.argv[2];
if (!domain) {
  process.stderr.write("usage: node prod-reminder-recipients.mjs <shop-domain>\n");
  process.exit(2);
}

/**
 * Domains that can never receive mail. RFC 2606 reserves `example.{com,net,org}`
 * and the `.test`, `.example`, `.invalid` and `.localhost` TLDs for
 * documentation and testing; RFC 6761 reiterates it. Shopify's own seeded sample
 * customers use `example.com`, which is exactly how a demo store ends up looking
 * fully populated while being incapable of receiving a single notification.
 */
const RESERVED_DOMAIN = /(^|\.)(example\.(com|net|org)|test|example|invalid|localhost)$/i;

/** Notification events worth reporting; anything else is store bookkeeping. */
const MAIL_ACTIONS = new Set([
  "mail_sent",
  "payment_reminder_sent",
  "invoice_sent",
  "order_invoice_sent",
]);

const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/** Random per run: equality stays answerable, the address stays unrecoverable. */
const RUN_SALT = randomBytes(32).toString("hex");

function fingerprint(address) {
  return createHash("sha256")
    .update(`${RUN_SALT}:${address.toLowerCase()}`)
    .digest("hex")
    .slice(0, 12);
}

const ORDER_EVENTS = `#graphql
  query OrderNotificationEvents($id: ID!) {
    order(id: $id) {
      id
      name
      events(first: 50, sortKey: CREATED_AT, reverse: true) {
        nodes { id createdAt action message appTitle }
      }
    }
  }
`;

const db = new PrismaClient();

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion: ApiVersion.July26,
  scopes: process.env.SCOPES?.split(","),
  appUrl: process.env.SHOPIFY_APP_URL || "",
  authPathPrefix: "/auth",
  sessionStorage: new PrismaSessionStorage(db),
  distribution: AppDistribution.AppStore,
  future: { expiringOfflineAccessTokens: true },
  logger: {
    log: (severity, message) => {
      if (severity <= 1) process.stderr.write(`[shopify-api] ${message}\n`);
    },
  },
});

async function eventsFor(orderGid) {
  try {
    const { admin } = await shopify.unauthenticated.admin(domain);
    const response = await admin.graphql(ORDER_EVENTS, {
      variables: { id: orderGid },
    });
    const body = await response.json();
    if (Array.isArray(body.errors) && body.errors.length > 0) {
      // Scrubbed: a GraphQL error message can quote the offending argument.
      return { error: JSON.stringify(body.errors).replace(EMAIL_PATTERN, "<redacted>") };
    }
    return { order: body?.data?.order ?? null };
  } catch (error) {
    return { error: String(error).replace(EMAIL_PATTERN, "<redacted>") };
  }
}

const orders = await db.ledgerOrder.findMany({
  where: { shop: domain },
  select: { orderGid: true, name: true, hasPaymentTerms: true },
  orderBy: { name: "asc" },
});

const report = [];
const domainTally = {};

for (const order of orders) {
  const { order: live, error } = await eventsFor(order.orderGid);
  if (error || live === null) {
    report.push({ orderName: order.name, orderGid: order.orderGid, error: error ?? "order not found" });
    continue;
  }

  const notifications = [];
  for (const node of live.events.nodes) {
    if (!MAIL_ACTIONS.has(node.action)) continue;
    const found = new Set(JSON.stringify(node).match(EMAIL_PATTERN) ?? []);
    for (const address of found) {
      const recipientDomain = address.split("@")[1] ?? "";
      const reserved = RESERVED_DOMAIN.test(recipientDomain);
      domainTally[recipientDomain] = (domainTally[recipientDomain] ?? 0) + 1;
      notifications.push({
        action: node.action,
        createdAt: node.createdAt,
        appTitle: node.appTitle,
        recipientFingerprint: fingerprint(address),
        recipientDomain,
        deliverable: !reserved,
      });
    }
  }

  report.push({
    orderName: live.name,
    orderGid: order.orderGid,
    hasPaymentTerms: order.hasPaymentTerms,
    notifications,
    /** Distinct mailboxes this order has ever notified, by fingerprint. */
    distinctRecipients: [...new Set(notifications.map((row) => row.recipientFingerprint))],
    reminderSent: notifications.some((row) => row.action === "payment_reminder_sent"),
  });
}

const allNotifications = report.flatMap((row) => row.notifications ?? []);
const undeliverable = allNotifications.filter((row) => row.deliverable === false);

console.log(
  JSON.stringify(
    {
      queriedAt: new Date().toISOString(),
      shop: domain,
      ordersInspected: report.length,
      verdict: {
        notificationsSeen: allNotifications.length,
        toReservedDomains: undeliverable.length,
        /**
         * The whole point. TRUE means every notification this store has ever
         * emitted went to a domain that cannot receive mail — so an empty inbox
         * proves nothing about the code that asked for the send.
         */
        allRecipientsUndeliverable:
          allNotifications.length > 0 && undeliverable.length === allNotifications.length,
        distinctRecipients: [
          ...new Set(allNotifications.map((row) => row.recipientFingerprint)),
        ].length,
        recipientDomains: domainTally,
      },
      orders: report,
    },
    null,
    2,
  ),
);

await db.$disconnect();
