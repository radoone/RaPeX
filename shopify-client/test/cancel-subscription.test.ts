import { afterEach, describe, expect, it, vi } from "vitest";
import { cancelSubscription } from "../app/services/cancel-subscription.server";

vi.mock("../app/shopify.server", () => ({
  apiVersion: "2026-07",
  SHOPIFY_APP_GID: "gid://shopify/App/1",
  SHOPIFY_BILLING_MODE: "app-pricing",
}));

describe("Shopify subscription cancellation", () => {
  const shop = "example.myshopify.com";
  const request = new Request("https://example.com/app/settings", {
    headers: { Authorization: "Bearer app-bridge-token" },
  });
  const subscription = { id: "gid://shopify/AppSubscription/1", status: "ACTIVE" };
  const installation = { app: { id: "gid://shopify/App/1" }, activeSubscriptions: [subscription] };
  const owner = { access_token: "online-token", associated_user: { id: 42, account_owner: true } };

  afterEach(() => vi.unstubAllGlobals());

  it.each([
    { ...owner, associated_user: { id: 42, account_owner: false } },
    { ...owner, associated_user: { id: 43, account_owner: true } },
  ])("rejects a token without the current store owner's identity", async (token) => {
    const fetch = vi.fn().mockResolvedValueOnce(Response.json(token));
    vi.stubGlobal("fetch", fetch);
    expect(await cancelSubscription(request, shop, "42")).toBe("ownerRequired");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    { ...installation, app: { id: "gid://shopify/App/2" } },
    { ...installation, activeSubscriptions: [subscription, subscription] },
  ])("never cancels an ambiguous or unrelated installation subscription", async (currentAppInstallation) => {
    const fetch = vi.fn().mockResolvedValueOnce(Response.json(owner))
      .mockResolvedValueOnce(Response.json({ data: { currentAppInstallation } }));
    vi.stubGlobal("fetch", fetch);
    expect(await cancelSubscription(request, shop, "42")).toBe("failed");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("cancels only the server-identified subscription through the owner's online token", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(Response.json(owner))
      .mockResolvedValueOnce(Response.json({ data: { currentAppInstallation: installation } }))
      .mockResolvedValueOnce(Response.json({
        data: { appSubscriptionCancel: { appSubscription: { ...subscription, status: "CANCELLED" }, userErrors: [] } },
      }));
    vi.stubGlobal("fetch", fetch);
    expect(await cancelSubscription(request, shop, "42")).toBe("accepted");
    const [url, options] = fetch.mock.calls[2];
    expect(url).toBe("https://example.myshopify.com/admin/api/2026-07/graphql.json");
    expect(options.headers["X-Shopify-Access-Token"]).toBe("online-token");
    expect(JSON.parse(options.body).variables).toEqual({ id: subscription.id });
  });
});
