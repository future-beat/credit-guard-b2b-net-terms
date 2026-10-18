/**
 * The Sentry URL scrubber — ONE implementation, shared by both init sites (W-2).
 *
 * Shopify puts a LIVE session token in the `id_token` query parameter of every
 * embedded admin document request. `window.location.href` on the client and
 * `event.request.url` on the server both carry it, so an unscrubbed error event
 * hands a working credential to a third-party service (threat T-02-09). URL
 * scrubbing is not optional here.
 *
 * WHY THIS FILE IS `.mjs` AND NOT `.ts`: `instrument.server.mjs` is loaded by
 * RAW NODE via `NODE_OPTIONS='--import ./instrument.server.mjs'`, before any
 * bundler or loader exists — and production runs Node 20 (see Dockerfile), which
 * has no TypeScript type-stripping. A `.ts` module here would import fine on a
 * Node 22 dev machine and crash the production server at boot. Plain ESM with
 * JSDoc types is checked by `tsc` (tsconfig has `allowJs`) and runs everywhere:
 * raw Node, Vite's client bundle, and vitest.
 *
 * Deliberately imports NOTHING — no Sentry, no app modules — so tests can load
 * it without initialising an SDK, and so importing it from the instrumentation
 * entry point cannot perturb module-load order.
 */

/**
 * Query parameters that carry credentials on Shopify request URLs.
 *
 * `id_token` is the embedded-app session token; `hmac`/`signature` authenticate
 * OAuth and app-proxy callbacks; `code` is the OAuth authorization code.
 *
 * @type {readonly string[]}
 */
export const CREDENTIAL_QUERY_PARAMS = [
  "id_token",
  "session",
  "hmac",
  "signature",
  "access_token",
  "token",
  "code",
];

/** Absolute URLs carry a scheme; anything else is treated as origin-relative. */
const ABSOLUTE_URL = /^[a-z][a-z0-9+.-]*:\/\//i;

/**
 * A base for the parser. Relative URLs cannot be parsed without one, and this
 * value is never allowed to reach the output — see the relative branch below.
 */
const PARSE_BASE = "https://placeholder.invalid";

/**
 * Replace the VALUES of credential-bearing query parameters with a marker,
 * leaving every other part of the URL — path, and all other parameters — intact.
 *
 * Scrubbing rather than dropping is deliberate: the path and `shop` parameter are
 * most of an error report's diagnostic value, and a control that destroys all
 * context is a control people eventually switch off.
 *
 * @template {string | undefined | null} T
 * @param {T} url
 * @returns {T | string}
 */
export function redactUrl(url) {
  if (typeof url !== "string") return url;

  try {
    const parsed = new URL(url, PARSE_BASE);

    let redacted = false;
    for (const param of CREDENTIAL_QUERY_PARAMS) {
      if (parsed.searchParams.has(param)) {
        parsed.searchParams.set(param, "[redacted]");
        redacted = true;
      }
    }

    // Nothing sensitive present: return the ORIGINAL string rather than a
    // re-serialised one, so clean URLs are never silently normalised.
    if (!redacted) return url;

    return ABSOLUTE_URL.test(url)
      ? parsed.toString()
      : // Relative input: emit only path + query so PARSE_BASE cannot leak into
        // an event and masquerade as a real host.
        `${parsed.pathname}${parsed.search}`;
  } catch {
    // FAIL CLOSED. An unparseable URL is dropped rather than forwarded
    // unscrubbed: this control exists to keep tokens out of Sentry, so the safe
    // failure is losing a diagnostic, not leaking a credential.
    return "[redacted]";
  }
}
