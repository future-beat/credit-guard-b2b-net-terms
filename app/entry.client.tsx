import { startTransition, StrictMode } from "react";
import { hydrateRoot } from "react-dom/client";
import { HydratedRouter } from "react-router/dom";
import * as Sentry from "@sentry/react-router";

import { redactUrl } from "./sentry-redact.mjs";

/**
 * Browser-side Sentry init (D-03). This file replaces React Router's implicit
 * default client entry; everything below the Sentry block is that default,
 * unchanged.
 *
 * PRIVACY (must_haves prohibition, threat T-01-07): `sendDefaultPii` stays off
 * and `beforeSend` scrubs the URL. The embedded admin loads this app with a live
 * session token in the `id_token` query parameter, which `window.location.href`
 * would otherwise carry straight into every event.
 *
 * The scrubber itself is shared with the server init (instrument.server.mjs)
 * rather than duplicated here — W-2.
 */
Sentry.init({
  // Exposed to the bundle via Vite's `envPrefix` (see vite.config.ts). A DSN is
  // a public, write-only ingest key by design — it is not a secret.
  dsn: import.meta.env.SENTRY_DSN,
  environment: import.meta.env.MODE,
  tracesSampleRate: 0.1,
  sendDefaultPii: false,
  integrations: [Sentry.reactRouterTracingIntegration()],
  beforeSend(event) {
    if (event.request) {
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

startTransition(() => {
  hydrateRoot(
    document,
    <StrictMode>
      <HydratedRouter onError={Sentry.sentryOnError} />
    </StrictMode>,
  );
});
