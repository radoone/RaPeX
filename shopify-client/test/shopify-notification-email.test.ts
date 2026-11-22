import { describe, expect, it, vi } from "vitest";
import { getShopifyNotificationEmail } from "../app/services/shopify-notification-email.server";

describe("Shopify notification address", () => {
  it("uses the shop contact configured in Shopify first", async () => {
    const graphql = vi.fn().mockResolvedValue(Response.json({
      data: { shop: { contactEmail: " Contact@Example.com " } },
    }));

    expect(await getShopifyNotificationEmail({ graphql })).toBe("contact@example.com");
    expect(graphql).toHaveBeenCalledTimes(1);
  });

  it("falls back to the shop email when the contact field is unavailable", async () => {
    const graphql = vi.fn()
      .mockResolvedValueOnce(Response.json({ data: null, errors: [{ message: "Unavailable" }] }))
      .mockResolvedValueOnce(Response.json({ data: { shop: { email: "store@example.com" } } }));

    expect(await getShopifyNotificationEmail({ graphql })).toBe("store@example.com");
  });

  it("keeps the recipient unset when Shopify returns no usable address", async () => {
    const graphql = vi.fn()
      .mockResolvedValueOnce(Response.json({ data: { shop: { contactEmail: "not an email" } } }))
      .mockRejectedValueOnce(new Error("unavailable"));

    expect(await getShopifyNotificationEmail({ graphql })).toBeNull();
  });
});
