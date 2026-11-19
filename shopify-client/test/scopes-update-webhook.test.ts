import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  webhook: vi.fn(),
  docs: new Map<string, Record<string, unknown>>(),
  updateSpy: vi.fn(),
  setSpy: vi.fn(),
}));

vi.mock("../app/shopify.server", () => ({
  authenticate: {
    webhook: mocks.webhook,
  },
}));

vi.mock("../app/firestore.server", () => ({
  firestore: {
    collection: (name: string) => ({
      doc: (id: string) => ({ path: `${name}/${id}`, id }),
    }),
    runTransaction: async (fn: (tx: any) => Promise<void>) =>
      fn({
        get: async (ref: { path: string }) => {
          const data = mocks.docs.get(ref.path);
          return { exists: Boolean(data), data: () => data };
        },
        update: (ref: { path: string }, values: Record<string, unknown>) => {
          mocks.updateSpy(ref.path, values);
          const existing = mocks.docs.get(ref.path);
          if (!existing) throw new Error("missing");
          mocks.docs.set(ref.path, { ...existing, ...values });
        },
        set: mocks.setSpy,
      }),
  },
}));

import { action } from "../app/routes/webhooks.app.scopes_update";

describe("webhooks.app.scopes_update", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.docs.clear();
  });

  it("updates only scope and updatedAt on an existing session without clobbering tokens", async () => {
    const key = "shopify_sessions/offline_example.myshopify.com";
    mocks.docs.set(key, {
      id: "offline_example.myshopify.com",
      shop: "example.myshopify.com",
      scope: "read_products",
      accessToken: "enc:v1:keep-access",
      refreshToken: "enc:v1:keep-refresh",
    });
    mocks.webhook.mockResolvedValue({
      topic: "APP_SCOPES_UPDATE",
      shop: "example.myshopify.com",
      session: { id: "offline_example.myshopify.com" },
      payload: { current: ["read_products", "read_inventory"] },
    });

    const response = await action({ request: new Request("https://example.test/webhooks/app/scopes_update", { method: "POST" }) } as never);
    expect(response.status).toBe(200);
    expect(mocks.updateSpy).toHaveBeenCalledTimes(1);
    expect(mocks.updateSpy).toHaveBeenCalledWith(
      key,
      expect.objectContaining({
        scope: "read_products,read_inventory",
        updatedAt: expect.any(Date),
      }),
    );
    expect(mocks.docs.get(key)).toMatchObject({
      scope: "read_products,read_inventory",
      accessToken: "enc:v1:keep-access",
      refreshToken: "enc:v1:keep-refresh",
    });
    expect(mocks.setSpy).not.toHaveBeenCalled();
  });

  it("does not resurrect a deleted session document", async () => {
    mocks.webhook.mockResolvedValue({
      topic: "APP_SCOPES_UPDATE",
      shop: "example.myshopify.com",
      session: { id: "offline_example.myshopify.com" },
      payload: { current: ["read_products"] },
    });

    const response = await action({ request: new Request("https://example.test/webhooks/app/scopes_update", { method: "POST" }) } as never);
    expect(response.status).toBe(200);
    expect(mocks.updateSpy).not.toHaveBeenCalled();
    expect(mocks.setSpy).not.toHaveBeenCalled();
    expect(mocks.docs.size).toBe(0);
  });
});
