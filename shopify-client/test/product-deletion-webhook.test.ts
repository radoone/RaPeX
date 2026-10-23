import { expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ queue: vi.fn(), webhook: vi.fn() }));
vi.mock("../app/shopify.server", () => ({ authenticate: { webhook: mocks.webhook } }));
vi.mock("../app/services/safety-gate-checker.server", () => ({ queueShopifyProductDeletion: mocks.queue }));
const { action } = await import("../app/routes/webhooks.products.delete");
it("orders deletion by the signed event time rather than an older product edit time", async () => {
  mocks.webhook.mockResolvedValue({ shop: "example.myshopify.com", payload: { id: 1, updated_at: "2026-10-23T10:00:00Z" } });
  const request = new Request("https://app.example/webhooks/products/delete", { method: "POST", headers: { "X-Shopify-Triggered-At": "2026-10-23T10:02:00Z" } });
  const response = await action({ request } as Parameters<typeof action>[0]);
  expect(response.status).toBe(202);
  expect(mocks.queue).toHaveBeenLastCalledWith({ shop: "example.myshopify.com", productId: "1", sourceUpdatedAt: "2026-10-23T10:02:00Z" });
});
