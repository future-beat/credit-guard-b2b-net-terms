import type { Config } from "@react-router/dev/config";
import { sentryOnBuildEnd } from "@sentry/react-router";

/**
 * Previously implicit (the template relied on React Router's defaults). It now
 * exists solely to hang Sentry's `buildEnd` hook, which injects debug IDs and
 * uploads source maps — a no-op until SENTRY_AUTH_TOKEN is set, since
 * `sourcemaps.disable` in vite.config.ts short-circuits it (D-03).
 *
 * `ssr: true` is React Router's default and is stated explicitly here so a
 * future edit cannot silently turn this Shopify app into an SPA.
 */
export default {
  ssr: true,
  buildEnd: async (args) => {
    await sentryOnBuildEnd(args);
  },
} satisfies Config;
