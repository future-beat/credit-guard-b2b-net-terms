/**
 * Unauthenticated health check for the host's healthcheck probe (Railway).
 *
 * This module must never import the app's Shopify server module: the probe has
 * no session token, so any authentication would fail the check and stall the
 * deploy. Keep it dependency-free and side-effect-free — no DB call, so a slow
 * database can never take the whole service out of rotation.
 */
export const loader = () => new Response("ok", { status: 200 });
