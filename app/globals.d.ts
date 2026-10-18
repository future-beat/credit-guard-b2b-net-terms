declare module "*.css";

/**
 * `s-app-nav` is the App Bridge navigation menu element. It is provided by the
 * App Bridge CDN script (app-bridge.js), not by the Polaris web-components
 * bundle, so `@shopify/polaris-types` does not declare it — the upstream
 * template ships `<s-app-nav>` in app/routes/app.tsx and does not typecheck
 * clean without a declaration like this one.
 */
type AppNavProps = {
  children?: React.ReactNode;
  slot?: Lowercase<string>;
  key?: React.Key;
  ref?: React.Ref<HTMLElement>;
};

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "s-app-nav": AppNavProps;
    }
  }
}

declare global {
  namespace JSX {
    interface IntrinsicElements {
      "s-app-nav": AppNavProps;
    }
  }
}

export {};
