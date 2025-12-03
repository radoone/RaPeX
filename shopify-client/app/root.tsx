import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useLoaderData,
} from "@remix-run/react";
import { useEffect } from "react";
import { AppProvider } from "@shopify/shopify-app-remix/react";
import { authenticate } from "./shopify.server";
import "./i18n";
import i18n from "./i18n";
import themeStyles from "./styles/theme.css?url";

// Note: Polaris styles are loaded via CDN polaris.js - no need for duplicate import
export const links = () => [
  { rel: "stylesheet", href: themeStyles },
];

export const loader = async ({ request }: { request: Request }) => {
  const url = new URL(request.url);
  
  // Skip authentication for auth routes - they handle their own auth
  if (!url.pathname.startsWith("/auth")) {
    await authenticate.admin(request);
  }
  
  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();

  // Sync document language so Polaris web components render localized copy.
  useEffect(() => {
    const syncLang = () => {
      const lang = i18n.language || "en";
      document.documentElement.setAttribute("lang", lang);
    };

    syncLang();
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
        <link
          rel="stylesheet"
          href="https://cdn.shopify.com/static/fonts/inter/v4/styles.css"
        />
        <script src="https://cdn.shopify.com/shopifycloud/app-bridge.js"></script>
        <script src="https://cdn.shopify.com/shopifycloud/polaris.js"></script>
        <Meta />
        <Links />
      </head>
      <body>
        <AppProvider isEmbeddedApp apiKey={apiKey}>
          <Outlet />
        </AppProvider>
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}
