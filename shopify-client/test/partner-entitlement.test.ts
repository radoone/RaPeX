import { describe, expect, it } from "vitest";
import { partnerEntitlement } from "../app/services/partner-entitlement";

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
  it("does not grant access for absent contracts or missing/inactive prices", () => {
    expect(partnerEntitlement(null, shop, now).active).toBe(false);
    for (const price of [undefined, {}, { active: false }])
      expect(
        partnerEntitlement({ ...contract, items: [{ price }] }, shop, now)
          .active,
      ).toBe(false);
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
