import type { ActionFunctionArgs } from "react-router";
import { validateWebhookRequest } from "../services/webhook-validate.server";
import db from "../db.server";
import { deactivateShop } from "../services/shop-lifecycle.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await validateWebhookRequest(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  // The access tokens are dead the moment the app is uninstalled, so this runs
  // unconditionally — deleteMany is a no-op on redelivery.
  //
  // This route deliberately never LOADS a session either. The library's
  // `authenticate.webhook` refreshes an expired offline token between the HMAC
  // check and the handler, and an uninstalled store's token is exactly the one
  // Shopify refuses to refresh: the delivery then 500s for ~48h of retries
  // while the merchant stays marked active (WINDOWS #31, fixed in 1.0.1).
  await db.session.deleteMany({ where: { shop } });

  // D-06 stage one: deactivate and RETAIN. Sessions (access tokens) go, because
  // they are dead the moment the app is uninstalled; every other row for this
  // merchant deliberately survives so a re-install inside Shopify's 48h window
  // restores their settings untouched. The hard delete happens only when
  // `shop/redact` arrives — see webhooks.compliance.tsx.
  //
  // Unconditional as well: a redelivery with no session must still converge on
  // the deactivated state.
  await deactivateShop(shop);

  return new Response();
};
