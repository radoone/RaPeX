import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  isRouteErrorResponse,
  useLoaderData,
  useRouteError,
} from "react-router";
import { useEffect } from "react";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import i18n, { EU_LANGUAGES } from "./i18n";
import themeStyles from "./styles/theme.css?url";

// Note: Polaris styles are loaded via CDN polaris.js - no need for duplicate import
// Empty links array - all stylesheets loaded inline to prevent hydration mismatch
export const links = () => [];

const LANGUAGE_STORAGE_KEY = "safety-gate-language";
const SUPPORTED_LANGUAGE_CODES: ReadonlySet<string> = new Set(
  EU_LANGUAGES.map((language) => language.code),
);

export const loader = async () => {
  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();

  // Sync document language so Polaris web components render localized copy.
  useEffect(() => {
    const syncLang = () => {
      const lang = i18n.resolvedLanguage || i18n.language || "en";
      document.documentElement.setAttribute("lang", lang);
    };

    const savedLanguage =
      window.localStorage.getItem(LANGUAGE_STORAGE_KEY) ||
      window.localStorage.getItem("i18nextLng");

    if (
      savedLanguage &&
      SUPPORTED_LANGUAGE_CODES.has(savedLanguage) &&
      savedLanguage !== i18n.language
    ) {
      void i18n.changeLanguage(savedLanguage);
    } else {
      syncLang();
    }

    i18n.on("languageChanged", syncLang);
    return () => {
      i18n.off("languageChanged", syncLang);
    };
  }, []);

  return (
    <html lang="en" suppressHydrationWarning>
      <head suppressHydrationWarning>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <meta name="shopify-api-key" content={apiKey} />
        <link rel="preconnect" href="https://cdn.shopify.com/" />
        <link rel="stylesheet" href="https://cdn.shopify.com/static/fonts/inter/v4/styles.css" />
        <link rel="stylesheet" href={themeStyles} />
        <script src="https://cdn.shopify.com/shopifycloud/app-bridge.js"></script>
        <script src="https://cdn.shopify.com/shopifycloud/polaris.js"></script>
        <Meta />
        <Links />
      </head>
      <body>
        <AppProvider apiKey={apiKey}>
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
        <title>Safety Gate Monitor</title>
        <link rel="preconnect" href="https://cdn.shopify.com/" />
        <link rel="stylesheet" href="https://cdn.shopify.com/static/fonts/inter/v4/styles.css" />
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
