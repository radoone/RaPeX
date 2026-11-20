import { describe, expect, it } from "vitest";
import { displayShopifyPlan, partnerEntitlement } from "../app/services/partner-entitlement";

describe("verified Partner contract", () => {
  const now = Date.parse("2026-10-23T12:00:00Z");
  const contract = {
    shop: { id: "gid://shopify/Shop/1" },
    items: [{ handle: "monthly", price: { active: true } }],
    currentBillingCycle: { endTime: "2026-11-01T00:00:00Z" },
  };
  const shop = contract.shop.id;
  it("requires the same shop and a current finite billing period", () => {
    expect(partnerEntitlement(contract, shop, now).active).toBe(true);
    expect(() =>
      partnerEntitlement(contract, "gid://shopify/Shop/2", now),
    ).toThrow(/shop/);
    for (const endTime of [null, "invalid", "2020-01-01T00:00:00Z"])
      expect(
        partnerEntitlement(
          { ...contract, currentBillingCycle: { endTime } },
          shop,
          now,
        ).active,
      ).toBe(false);
  });
  it("requires a contract and a current plan handle without relying on the price flag", () => {
    expect(partnerEntitlement(null, shop, now).active).toBe(false);
    for (const handle of [undefined, "", " "])
      expect(
        partnerEntitlement({ ...contract, items: [{ handle }] }, shop, now)
          .active,
      ).toBe(false);
    const freeTest = { ...contract, items: [{ handle: "journey-qa", price: { active: false, amount: "0.0" } }] };
    expect(partnerEntitlement(freeTest, shop, now)).toMatchObject({ active: true, planHandle: "journey-qa" });
  });
  it("accepts a verified trial and paid access until end of a cancelling cycle", () => {
    expect(
      partnerEntitlement(
        {
          ...contract,
          currentBillingCycle: null,
          trialEndsAt: "2026-10-24T00:00:00Z",
        },
        shop,
        now,
      ).active,
    ).toBe(true);
    expect(
      partnerEntitlement({ ...contract, cancelAtEndOfCycle: true }, shop, now),
    ).toMatchObject({ active: true, cancelAtEndOfCycle: true });
  });
});

it("displays the verified Shopify plan without substituting Pro for test plans", () => {
  expect(displayShopifyPlan("shopify-test")).toBe("Review test");
  expect(displayShopifyPlan("zerorecall-pro")).toBe("ZeroRecall Pro");
  expect(displayShopifyPlan(null)).toBeNull();
});
