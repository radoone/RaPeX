import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

export const loader = async ({ request, url }: LoaderFunctionArgs) => {
  
  // Skip authentication for login path - it's handled by auth.login route
  if (url.pathname === "/auth/login") {
    return null;
  }
  
  try {
    await authenticate.admin(request);
  } catch (response) {
    // The SDK serves an HTML App Bridge bootstrap while Shopify refreshes the session.
    if (!(response instanceof Response) || response.status !== 200 ||
        !response.headers.get("content-type")?.startsWith("text/html")) throw response;

    const slovak = /^sk(?:-|$)/i.test(url.searchParams.get("locale") || "");
    const label = slovak ? "Otvára sa ZeroRecall…" : "Opening ZeroRecall…";
    const bootstrap = await response.text();
    const headers = new Headers(response.headers);
    headers.delete("content-length");
    return new Response(`<!doctype html><html lang="${slovak ? "sk" : "en"}">
      <head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ZeroRecall</title></head>
      <body style="background:#f6f6f7;color:#303030;font:16px system-ui,sans-serif">
        <main role="status" style="max-width:68rem;margin:2rem auto;padding:0 1.5rem">${label}</main>
        ${bootstrap}
      </body></html>`, { status: response.status, headers });
  }

  return null;
};
