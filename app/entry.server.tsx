import { renderToPipeableStream } from "react-dom/server";
import { ServerRouter } from "react-router";
import { createReadableStreamFromReadable } from "@react-router/node";
import { type AppLoadContext, type EntryContext } from "react-router";
import * as Sentry from "@sentry/react-router";
import { addDocumentResponseHeaders } from "./shopify.server";
import { startScheduler } from "./services/scheduler.server";

export const streamTimeout = 5000;

/**
 * Start the sweep scheduler (LEDG-04, LEDG-05).
 *
 * This module is the server bundle's once-per-process entry: React Router
 * imports it when the server boots, before any request, and never again — which
 * is exactly the lifecycle a long-lived timer needs. The alternatives were
 * `instrument.server.mjs` (loaded via NODE_OPTIONS before the app's module graph
 * exists, so it cannot import Prisma-backed services) and a route module
 * (imported per-route, and not at all until traffic arrives).
 *
 * `startScheduler` is itself guarded — it no-ops under vitest and NODE_ENV=test,
 * and a `globalThis` singleton flag makes a dev hot-reload re-import harmless —
 * so calling it at module scope is safe in every environment this file loads in.
 */
startScheduler();

/**
 * Sentry's drop-in `handleRequest` (research Code Examples 5). It owns the
 * streaming render so it can parametrize the route name and inject the trace
 * meta tags — behaviour we would otherwise have to reimplement by hand.
 *
 * The renderer is aborted 1s after `streamTimeout`, matching the template's
 * original margin so React can flush the rejected boundary contents.
 */
const sentryHandleRequest = Sentry.createSentryHandleRequest({
  ServerRouter,
  renderToPipeableStream,
  createReadableStreamFromReadable,
  streamTimeout: streamTimeout + 1000,
});

export default async function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  reactRouterContext: EntryContext,
  loadContext: AppLoadContext,
) {
  // Must run before delegating: Sentry's handler builds the Response from this
  // same Headers object, and dropping Shopify's CSP `frame-ancestors` header
  // breaks the app inside the admin iframe.
  addDocumentResponseHeaders(request, responseHeaders);

  return sentryHandleRequest(
    request,
    responseStatusCode,
    responseHeaders,
    reactRouterContext,
    loadContext,
  );
}

/**
 * Routes every loader/action/render error to Sentry. `logErrors: false` because
 * Sentry is the error sink for this app (D-03) — duplicate stdout traces only
 * add noise to the Railway deploy log.
 */
export const handleError = Sentry.createSentryHandleError({ logErrors: false });

export const instrumentations = [Sentry.createSentryServerInstrumentation()];
