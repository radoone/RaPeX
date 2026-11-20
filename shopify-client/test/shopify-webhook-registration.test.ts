import { beforeEach, describe, expect, it, vi } from "vitest";

const { get, set, register, graphql } = vi.hoisted(() => ({
  get: vi.fn(), set: vi.fn(), register: vi.fn(), graphql: vi.fn(),
}));
vi.mock("@shopify/shopify-app-react-router/server", () => ({
  ApiVersion: { July26: "2026-07" },
  AppDistribution: { AppStore: "app-store" },
  DeliveryMethod: { Http: "http" },
  shopifyApp: () => ({
    registerWebhooks: register,
    unauthenticated: { admin: async () => ({ admin: { graphql } }) },
  }),
}));
vi.mock("../app/firestore.server", () => ({
  firestore: { collection: () => ({ doc: () => ({ get, set }) }) },
}));
vi.mock("firebase-admin/firestore", () => ({
  FieldValue: { serverTimestamp: () => "server-timestamp" },
}));
vi.mock("../app/firestore-session-storage.server", () => ({
  FirestoreSessionStorage: class {},
}));

import { ensureShopifyWebhooksRegistered } from "../app/shopify.server";

describe("Shopify webhook registration", () => {
  const baseUrl = "https://example.test";
  const session = { shop: "example.myshopify.com" } as Parameters<typeof ensureShopifyWebhooksRegistered>[0];
  const endpoints = [
    { topic: "PRODUCTS_CREATE", uri: `${baseUrl}/webhooks/products/create` },
    { topic: "PRODUCTS_UPDATE", uri: `${baseUrl}/webhooks/products/update` },
    { topic: "PRODUCTS_DELETE", uri: `${baseUrl}/webhooks/products/delete` },
    { topic: "APP_UNINSTALLED", uri: `${baseUrl}/webhooks/app/uninstalled` },
  ];
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("SHOPIFY_APP_URL", baseUrl);
    get.mockResolvedValue({ get: () => null });
  });

  it("shares one registration attempt between simultaneous requests for a shop", async () => {
    register.mockResolvedValue({ PRODUCTS_CREATE: [{ success: true }] });
    await Promise.all([
      ensureShopifyWebhooksRegistered(session),
      ensureShopifyWebhooksRegistered(session),
    ]);
    expect(register).toHaveBeenCalledTimes(1);
    expect(set).toHaveBeenCalledTimes(1);
  });

  it("confirms a concurrent registration only if all destinations are present", async () => {
    register.mockResolvedValue({ PRODUCTS_CREATE: [{ success: false }] });
    graphql.mockResolvedValueOnce(Response.json({ data: {
      webhookSubscriptions: { nodes: endpoints.slice(1) },
    } }));
    await expect(ensureShopifyWebhooksRegistered(session)).rejects.toThrow(/registration failed/);
    expect(set).not.toHaveBeenCalled();

    graphql.mockResolvedValueOnce(Response.json({ data: {
      webhookSubscriptions: { nodes: endpoints },
    } }));
    await expect(ensureShopifyWebhooksRegistered(session)).resolves.toBeUndefined();
    expect(set).toHaveBeenCalledTimes(1);
  });
});
