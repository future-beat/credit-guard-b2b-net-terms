/**
 * Sentry server-side initialization (D-03).
 *
 * This file is loaded through `NODE_OPTIONS='--import ./instrument.server.mjs'`
 * on the `dev` and `start` scripts so the SDK installs its instrumentation
 * BEFORE the app's module graph is evaluated. Initializing Sentry from inside
 * the app (or client-side only) is the documented failure mode — server errors,
 * which is what D-03 exists for, silently never arrive (research Pitfall 5).
 *
 * PRIVACY (must_haves prohibition, threat T-01-07): error telemetry crosses out
 * of our infrastructure, so events carry stack traces and nothing else.
 * `sendDefaultPii` stays off, and `beforeSend` strips request bodies, headers
 * and cookies plus any credential-bearing query parameter. Shopify puts a live
 * session token in the `id_token` query parameter of every embedded document
 * request, so URL scrubbing is not optional here.
 */
import * as Sentry from "@sentry/react-router";

/**
 * The scrubber is shared with the client init (app/entry.client.tsx) rather than
 * duplicated here — W-2. Two hand-synced copies is how a privacy control quietly
 * drifts on one side only. `app/sentry-redact.mjs` is plain ESM precisely so this
 * file, loaded by raw Node before any bundler exists, can import it.
 */
import { redactUrl } from "./app/sentry-redact.mjs";

/**
 * The access-log scrubber (WINDOWS #8) — installed FIRST, before anything in
 * this process can print.
 *
 * `react-router-serve` hard-wires `app.use(morgan("tiny"))`, so every embedded
 * admin document request prints its full URL to stdout — including `id_token`,
 * the LIVE session JWT Shopify appends to all of them — and the host's log store
 * retains it. Same leak class as T-01-07, but Sentry's scrubbers never see it:
 * morgan writes to the stream directly.
 *
 * morgan cannot be configured from outside `react-router-serve`, and replacing
 * that server or adding a logging dependency would be a far larger surface than
 * the leak warrants. This file is already loaded by raw Node through
 * `NODE_OPTIONS='--import'` BEFORE the app's module graph, which makes it the
 * one place that can wrap the stream ahead of every writer.
 *
 * stderr is wrapped too: an error stack that quotes a request URL leaks exactly
 * the same credential.
 */
import { installAccessLogRedaction } from "./app/access-log-redact.mjs";

installAccessLogRedaction(process.stdout);
installAccessLogRedaction(process.stderr);

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV ?? "development",
  tracesSampleRate: 0.1,
  // Never attach IPs, headers, cookies or bodies to events.
  sendDefaultPii: false,
  beforeSend(event) {
    if (event.request) {
      // Webhook and admin request bodies contain merchant/customer data —
      // they must never leave the server.
      delete event.request.data;
      delete event.request.cookies;
      delete event.request.headers;
      event.request.url = redactUrl(event.request.url);
      if (event.request.query_string) {
        event.request.query_string = "[redacted]";
      }
    }
    return event;
  },
  beforeBreadcrumb(breadcrumb) {
    if (breadcrumb.data?.url) {
      breadcrumb.data.url = redactUrl(breadcrumb.data.url);
    }
    return breadcrumb;
  },
});
