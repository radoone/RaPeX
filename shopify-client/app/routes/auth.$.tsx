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
      <head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ZeroRecall</title>
        <style>
          html,body{margin:0;background:#f1f1f1;color:#303030;font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
          .bar{position:fixed;top:0;left:0;right:0;height:3px;background:rgba(0,91,211,.14);overflow:hidden}
          .bar::after{content:"";position:absolute;inset:0 auto 0 0;width:38%;background:#005bd3;border-radius:999px;animation:s 1.15s ease-in-out infinite}
          .card{max-width:60rem;margin:2rem auto;padding:1.25rem 1.5rem;background:#fff;border:1px solid #e3e3e3;border-radius:12px;display:flex;align-items:center;gap:.75rem}
          .dot{width:14px;height:14px;border:2px solid #d4d4d8;border-top-color:#005bd3;border-radius:50%;animation:r .8s linear infinite;flex:0 0 14px}
          @keyframes s{0%{transform:translateX(-110%)}100%{transform:translateX(360%)}}
          @keyframes r{to{transform:rotate(360deg)}}
        </style>
      </head>
      <body>
        <div class="bar" aria-hidden="true"></div>
        <main role="status" class="card"><span class="dot" aria-hidden="true"></span><span>${label}</span></main>
        ${bootstrap}
      </body></html>`, { status: response.status, headers });
  }

  return null;
};
