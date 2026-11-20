import { expect, it, vi } from "vitest";

const { authenticate, runCheck, requireBilling } = vi.hoisted(() => ({
  authenticate: vi.fn(),
  runCheck: vi.fn(),
  requireBilling: vi.fn(),
}));
vi.mock("../app/shopify.server", () => ({
  authenticate: { admin: authenticate },
  SHOPIFY_APP_HANDLE: "safety-gate-monitor-eu",
}));
vi.mock("../app/services/product-safety-admin.server", () => ({
  productSafetyReviewUrl: vi.fn(),
  runProductSafetyCheckForAdminProduct: runCheck,
}));
vi.mock("../app/services/billing.server", () => ({
  getPricingPlansUrl: vi.fn(),
  requireActiveBilling: requireBilling,
}));
vi.mock("../app/services/safety-gate-checker.server", () => ({
  ProductCheckExcludedError: class extends Error {},
}));

import { loader } from "../app/routes/api.product-safety-check";

it("routes the native extension preflight to the Shopify SDK without checking a product or billing", async () => {
  const request = new Request("https://example.com/api/product-safety-check", { method: "OPTIONS" });
  const preflight = new Response(null, { status: 204 });
  authenticate.mockRejectedValueOnce(preflight);
  await expect(loader({ request } as Parameters<typeof loader>[0])).rejects.toBe(preflight);
  expect(authenticate).toHaveBeenCalledWith(request);
  expect(requireBilling).not.toHaveBeenCalled();
  expect(runCheck).not.toHaveBeenCalled();
});

it("does not provide a read endpoint for the action route", async () => {
  authenticate.mockClear();
  const request = new Request("https://example.com/api/product-safety-check");
  const result = await loader({ request } as Parameters<typeof loader>[0]);
  expect(result.status).toBe(405);
  expect(authenticate).not.toHaveBeenCalled();
});
