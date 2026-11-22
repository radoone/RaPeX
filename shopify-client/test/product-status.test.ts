import { afterEach, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  safetyAlert: { findFirst: vi.fn(), findMany: vi.fn() },
  safetyCheck: { findMany: vi.fn() },
  safetySetting: { findUnique: vi.fn() },
}));
vi.mock("../app/merchant-db.server", () => ({ default: db }));
vi.mock("../app/services/catalog-audit-session.server", () => ({
  mirrorOfflineSessionForCatalogAudit: vi.fn(),
}));

import { getProductSafetyStatus, productSafetyReviewUrl } from "../app/services/product-safety-admin.server";
import { checkProductSafety, ProductCheckExcludedError } from "../app/services/safety-gate-checker.server";

const shop = "fixture.myshopify.com";

afterEach(() => vi.unstubAllGlobals());

it("keeps an older no-match result from being shown for an edited product", async () => {
  db.safetyAlert.findFirst.mockResolvedValue(null);
  db.safetyAlert.findMany.mockResolvedValue([]);
  db.safetyCheck.findMany.mockResolvedValue([{
    checkedAt: new Date("2026-11-19T11:00:00Z"),
    sourceUpdatedAt: "2026-11-19T10:00:00Z",
    isSafe: true,
  }]);
  expect((await getProductSafetyStatus(shop, "1", "2026-11-19T10:00:00Z")).state).toBe("safe");
  expect((await getProductSafetyStatus(shop, "1", "2026-11-20T10:00:00Z")).state).toBe("changed");
});

it("links a specific finding through Shopify Admin App Home", () => {
  expect(productSafetyReviewUrl(shop, "finding_1", "safety-gate-monitor-eu")).toBe(
    "https://admin.shopify.com/store/fixture/apps/safety-gate-monitor-eu/app/alerts?open=finding_1",
  );
  expect(productSafetyReviewUrl(shop, null, "safety-gate-monitor-eu")).toBeNull();
});

it("never returns a no-match result or calls the matcher for an excluded manual check", async () => {
  db.safetySetting.findUnique.mockResolvedValue({ excludeVendors: "Test vendor" });
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  await expect(
    checkProductSafety({ name: "Fixture", category: "toy", description: "", brand: "test vendor" }, 70, { shop }),
  ).rejects.toBeInstanceOf(ProductCheckExcludedError);
  expect(fetch).not.toHaveBeenCalled();
});
