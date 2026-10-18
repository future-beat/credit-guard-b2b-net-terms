import { reactRouter } from "@react-router/dev/vite";
import { sentryReactRouter } from "@sentry/react-router";
import { defineConfig, type UserConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

/**
 * Sentry build-time options (D-03). Source-map upload is optional at MVP —
 * error capture works without it — so everything reads from the environment and
 * activates the moment SENTRY_AUTH_TOKEN exists. Until then source maps are not
 * generated at all, which keeps unuploaded maps out of the deployed bundle.
 */
const sentryAuthToken = process.env.SENTRY_AUTH_TOKEN;
const sentryConfig = {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: sentryAuthToken,
  sourcemaps: { disable: !sentryAuthToken },
  // No build-time telemetry to Sentry — this app's Sentry surface is error
  // capture only (D-03), not analytics.
  telemetry: false,
};

// Related: https://github.com/remix-run/remix/issues/2835#issuecomment-1144102176
// Replace the HOST env var with SHOPIFY_APP_URL so that it doesn't break the Vite server.
// The CLI will eventually stop passing in HOST,
// so we can remove this workaround after the next major release.
if (
  process.env.HOST &&
  (!process.env.SHOPIFY_APP_URL ||
    process.env.SHOPIFY_APP_URL === process.env.HOST)
) {
  process.env.SHOPIFY_APP_URL = process.env.HOST;
  delete process.env.HOST;
}

const host = new URL(process.env.SHOPIFY_APP_URL || "http://localhost")
  .hostname;

let hmrConfig;
if (host === "localhost") {
  hmrConfig = {
    protocol: "ws",
    host: "localhost",
    port: 64999,
    clientPort: 64999,
  };
} else {
  hmrConfig = {
    protocol: "wss",
    host: host,
    port: parseInt(process.env.FRONTEND_PORT!) || 8002,
    clientPort: 443,
  };
}

// Function form: the Sentry plugin needs Vite's ConfigEnv (command/mode) to know
// whether this is a build worth attaching source-map machinery to.
export default defineConfig((viteEnv): UserConfig => ({
  // SENTRY_DSN is inlined into the client bundle for the browser SDK. A Sentry
  // DSN is a public write-only ingest key, not a secret; the narrow prefix keeps
  // every other server-side variable (SHOPIFY_API_SECRET, DATABASE_URL,
  // SENTRY_AUTH_TOKEN) out of the bundle.
  envPrefix: ["VITE_", "SENTRY_DSN"],
  server: {
    allowedHosts: [host],
    cors: {
      preflightContinue: true,
    },
    port: Number(process.env.PORT || 3000),
    hmr: hmrConfig,
    fs: {
      // See https://vitejs.dev/config/server-options.html#server-fs-allow for more information
      allow: ["app", "node_modules"],
    },
  },
  plugins: [
    reactRouter(),
    tsconfigPaths(),
    sentryReactRouter(sentryConfig, viteEnv),
  ],
  build: {
    assetsInlineLimit: 0,
    // Only emit source maps when they can actually be uploaded to Sentry.
    sourcemap: sentryAuthToken ? ("hidden" as const) : false,
  },
  optimizeDeps: {
    include: ["@shopify/app-bridge-react"],
  },
}));
