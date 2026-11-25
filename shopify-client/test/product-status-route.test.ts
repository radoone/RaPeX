import { expect, it, vi } from "vitest";

const { authenticate, getStatus, reviewUrl } = vi.hoisted(() => ({
  authenticate: vi.fn(),
  getStatus: vi.fn(),
  reviewUrl: vi.fn(),
}));

vi.mock("../app/shopify.server", () => ({
  authenticate: { admin: authenticate },
  SHOPIFY_APP_HANDLE: "safety-gate-monitor-eu",
}));

vi.mock("../app/services/product-safety-admin.server", () => ({
  getProductSafetyStatus: getStatus,
  productSafetyReviewUrl: reviewUrl,
}));

import { loader } from "../app/routes/api.product-safety-status";

it("reads productId from request.url when React Router omits url from LoaderFunctionArgs", async () => {
  const graphql = vi.fn().mockResolvedValue(
    Response.json({ data: { product: { updatedAt: "2026-11-23T08:00:00Z" } } }),
  );
  authenticate.mockResolvedValueOnce({
    admin: { graphql },
    session: { shop: "example.myshopify.com" },
    cors: (res: Response) => res,
  });
  getStatus.mockResolvedValueOnce({ state: "clear", alertId: null });
  reviewUrl.mockReturnValueOnce(null);

  const request = new Request(
    "https://example.com/api/product-safety-status?productId=gid%3A%2F%2Fshopify%2FProduct%2F123",
  );
  const response = await loader({ request } as Parameters<typeof loader>[0]);
  expect(response.status).toBe(200);
  expect(getStatus).toHaveBeenCalledWith(
    "example.myshopify.com",
    "gid://shopify/Product/123",
    "2026-11-23T08:00:00Z",
  );
  await expect(response.json()).resolves.toEqual({ state: "clear", alertId: null, reviewUrl: null });
});
