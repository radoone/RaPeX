import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  isRouteErrorResponse,
  useLoaderData,
  type LoaderFunctionArgs,
  useRouteError,
} from "react-router";
import { useEffect, useRef } from "react";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { POLARIS_URL } from "./polaris";
import i18n, { changeMerchantLanguage } from "./i18n";
import { preferredInterfaceLanguage } from "./services/interface-language";
import themeStyles from "./styles/theme.css?url";

// Note: Polaris styles are loaded via CDN polaris.js - no need for duplicate import
// Empty links array - all stylesheets loaded inline to prevent hydration mismatch
export const links = () => [];


export const loader = async ({ request }: LoaderFunctionArgs) => {
  return { apiKey: process.env.SHOPIFY_API_KEY || "", shopifyLocale: new URL(request.url).searchParams.get("locale") || undefined };
};

export default function App() {
  const { apiKey, shopifyLocale } = useLoaderData<typeof loader>();
  const lastShopifyLocale = useRef<string | undefined>(undefined);

  // Load the Inter font stylesheet without blocking first paint.
  useEffect(() => {
    const href = "https://cdn.shopify.com/static/fonts/inter/v4/styles.css";
    if (document.querySelector(`link[rel="stylesheet"][href="${href}"]`)) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    document.head.appendChild(link);
  }, []);

  // Sync document language so Polaris web components render localized copy.
  useEffect(() => {
    if (shopifyLocale) lastShopifyLocale.current = shopifyLocale;
    const syncLang = () => {
      const lang = i18n.resolvedLanguage || i18n.language || "en";
      document.documentElement.setAttribute("lang", lang);
    };

    const savedLanguage = preferredInterfaceLanguage(shopifyLocale || lastShopifyLocale.current);

    if (
      savedLanguage &&
      savedLanguage !== i18n.language
    ) {
      void changeMerchantLanguage(savedLanguage).catch(() => console.warn("Could not load the saved app language"));
    } else {
      syncLang();
    }

    i18n.on("languageChanged", syncLang);
    return () => {
      i18n.off("languageChanged", syncLang);
    };
  }, [shopifyLocale]);

  return (
    <html lang="en" suppressHydrationWarning>
      <head suppressHydrationWarning>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <meta name="shopify-api-key" content={apiKey} />
        <link rel="preconnect" href="https://cdn.shopify.com/" />
        <link rel="preload" as="script" href="https://cdn.shopify.com/shopifycloud/app-bridge.js" />
        <link rel="preload" as="script" href={POLARIS_URL} />
        <link rel="preload" as="style" href="https://cdn.shopify.com/static/fonts/inter/v4/styles.css" />
        <link rel="stylesheet" href={themeStyles} />
        <Meta />
        <Links />
      </head>
      <body style={{ margin: 0, background: "#f1f1f1" }}>
        <AppProvider apiKey={apiKey} polarisUrl={POLARIS_URL}>
          <Outlet />
        </AppProvider>
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  let errorMessage = "An unexpected error occurred.";

  if (isRouteErrorResponse(error)) {
    errorMessage = `${error.status} ${error.statusText || ""}`.trim();
  } else if (error instanceof Error) {
    errorMessage = error.message;
  }

  return (
    <html lang="en" suppressHydrationWarning>
      <head suppressHydrationWarning>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <title>ZeroRecall</title>
        <link rel="preconnect" href="https://cdn.shopify.com/" />
        <link rel="preload" as="style" href="https://cdn.shopify.com/static/fonts/inter/v4/styles.css" />
        <link rel="stylesheet" href={themeStyles} />
        <Meta />
        <Links />
      </head>
      <body>
        <div style={{ maxWidth: "600px", margin: "40px auto", padding: "24px", background: "#fff", borderRadius: "8px", border: "1px solid #dcdfe3", fontFamily: "Inter, sans-serif" }}>
          <h2 style={{ fontSize: "18px", margin: "0 0 12px 0", color: "#b91c1c" }}>Unable to load page</h2>
          <p style={{ fontSize: "14px", color: "#475569", margin: "0 0 16px 0" }}>{errorMessage}</p>
          <button
            onClick={() => window.location.reload()}
            style={{ padding: "8px 16px", background: "#008060", color: "#fff", border: "none", borderRadius: "6px", cursor: "pointer", fontSize: "14px", fontWeight: 500 }}
          >
            Reload application
          </button>
        </div>
        <Scripts />
      </body>
    </html>
  );
}
