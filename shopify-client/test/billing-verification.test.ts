import { beforeEach, describe, expect, it, vi } from "vitest";
const { upsert, findUnique } = vi.hoisted(() => ({
  upsert: vi.fn(),
  findUnique: vi.fn(),
}));
vi.mock("../app/shopify.server", () => ({
  SHOPIFY_APP_GID: "gid://shopify/App/1",
  SHOPIFY_APP_HANDLE: "safety-gate-monitor-eu",
  SHOPIFY_BILLING_BYPASS: false,
  SHOPIFY_BILLING_MODE: "app-pricing",
  SHOPIFY_BILLING_TEST: false,
  SHOPIFY_PARTNER_API_TOKEN: "unit-test-placeholder",
  SHOPIFY_PARTNER_API_VERSION: "2026-07",
  SHOPIFY_PARTNER_ORG_ID: "123",
}));
vi.mock("../app/merchant-db.server", () => ({
  default: { safetySetting: { upsert, findUnique } },
}));
import {
  getBillingStatus,
  requireActiveBilling,
} from "../app/services/billing.server";

describe("production billing verification", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    upsert.mockReset().mockResolvedValue({});
    findUnique.mockReset().mockResolvedValue({ freeScanUsed: true });
  });
  const admin = {
    graphql: vi.fn(
      async () =>
        new Response(
          JSON.stringify({ data: { shop: { id: "gid://shopify/Shop/1" } } }),
        ),
    ),
  };
  function provider(subscription: unknown, errors?: unknown[]) {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              data: { activeSubscription: subscription },
              errors,
            }),
          ),
      ),
    );
  }
  const contract = {
    shop: { id: "gid://shopify/Shop/1" },
    items: [{ handle: "monthly", price: { active: true } }],
    currentBillingCycle: { endTime: "2099-11-01T00:00:00Z" },
  };
  it("persists only a verified matching current contract", async () => {
    provider(contract);
    const result = await getBillingStatus({}, "example.myshopify.com", admin);
    expect(result).toMatchObject({
      hasActivePayment: true,
      billingVerified: true,
      canPerformScan: true,
      developmentBypass: false,
    });
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          monitoringEntitled: true,
          subscriptionStatus: "active",
          planHandle: "monthly",
        }),
      }),
    );
  });
  it("fails closed for API errors and another tenant's contract", async () => {
    for (const value of [
      { ...contract, shop: { id: "gid://shopify/Shop/2" } },
      null,
    ]) {
      provider(value, value === null ? [{ message: "Forbidden" }] : undefined);
      expect(
        await getBillingStatus({}, "example.myshopify.com", admin),
      ).toMatchObject({
        hasActivePayment: false,
        billingVerified: false,
        canPerformScan: false,
      });
    }
  });
  it("does not grant access when entitlement persistence fails", async () => {
    provider(contract);
    upsert.mockRejectedValue(new Error("database unavailable"));
    expect(
      await getBillingStatus({}, "example.myshopify.com", admin),
    ).toMatchObject({ hasActivePayment: false, canPerformScan: false });
    const result = await requireActiveBilling({}, "example.myshopify.com", {
      admin,
    });
    expect(result?.headers.get("Location")).toContain("billingError=1");
  });
  it("a verified missing contract leads to hosted plan selection", async () => {
    provider(null);
    expect(
      await getBillingStatus({}, "example.myshopify.com", admin),
    ).toMatchObject({ hasActivePayment: false, billingVerified: true });
    const result = await requireActiveBilling({}, "example.myshopify.com", {
      admin,
    });
    expect(result?.headers.get("Location")).toContain("pricing_plans");
  });
});
