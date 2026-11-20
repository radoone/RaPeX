import { describe, expect, it } from "vitest";
import { createRequestHandler, type ServerBuild } from "react-router";
import config from "../react-router.config";

function handler(onAction: () => void) {
  const action = () => { onAction(); return Response.json({ reached: true }); };
  return createRequestHandler({
    mode: "production", basename: "/", ssr: true, prerender: [],
    publicPath: "/build/", assetsBuildDirectory: "public/build",
    future: config.future, allowedActionOrigins: config.allowedActionOrigins,
    routeDiscovery: { mode: "initial", manifestPath: "/__manifest" },
    assets: { version: "test", url: "/build/manifest.js", entry: { module: "/test.js", imports: [] }, routes: {} },
    entry: { module: { default: (_request: Request, status: number, headers: Headers) => new Response("rendered", { status, headers }), handleError: () => {} } },
    routes: {
      root: { id: "root", path: "", module: { default: () => null } },
      ui: { id: "ui", parentId: "root", path: "probe", module: { default: () => null, action } },
      resource: { id: "resource", parentId: "root", path: "api/probe", module: { action: () => new Response(null, { status: 401 }) } },
    },
  } as unknown as ServerBuild, "production");
}

describe("Shopify UI actions behind Cloud Run HTTPS termination", () => {
  const host = config.allowedActionOrigins[0];
  it.each(["/probe", "/probe.data"])("accepts the exact public app origin for %s behind an internal HTTP server", async path => {
    let reached = false;
    const response = await handler(() => { reached = true; })(new Request(`http://localhost:8080${path}`, {
      method: "POST", headers: { origin: `https://${host}`, "content-type": "application/x-www-form-urlencoded" }, body: "fixture=1",
    }));
    expect(response.status).toBe(200);
    expect(reached).toBe(true);
  });
  it.each(["https://evil.example", "https://admin.shopify.com", "null"])("rejects an untrusted UI origin %s before running its action", async origin => {
    let reached = false;
    const response = await handler(() => { reached = true; })(new Request("http://localhost:8080/probe", {
      method: "POST", headers: { origin, "x-forwarded-host": host, "content-type": "application/x-www-form-urlencoded" }, body: "fixture=1",
    }));
    expect(response.status).toBe(400);
    expect(reached).toBe(false);
  });
  it("leaves cross-origin resource requests under their own authentication", async () => {
    const response = await handler(() => {})(new Request("http://localhost:8080/api/probe", {
      method: "POST", headers: { origin: "https://admin.shopify.com" },
    }));
    expect(response.status).toBe(401);
  });
});
