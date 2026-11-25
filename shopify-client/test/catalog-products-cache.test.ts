import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getCachedCatalogProducts,
  invalidateCatalogProductsCache,
} from "../app/services/catalog-products-cache.server";

describe("per-shop catalog products cache", () => {
  const shop = "example.myshopify.com";

  beforeEach(() => {
    invalidateCatalogProductsCache();
  });

  function makeAdmin(products = [{ id: "gid://shopify/Product/1", title: "Toy", updatedAt: "2026-11-25T08:00:00Z" }]) {
    return {
      graphql: vi.fn(async () => ({
        json: async () => ({
          data: {
            products: {
              pageInfo: { hasNextPage: false, endCursor: null },
              nodes: products,
            },
          },
        }),
      })),
    };
  }

  it("caches catalog products within TTL and deduplicates concurrent requests", async () => {
    const admin = makeAdmin();
    let now = 1_000;
    const [first, second] = await Promise.all([
      getCachedCatalogProducts(shop, admin, () => now),
      getCachedCatalogProducts(shop, admin, () => now),
    ]);
    expect(first).toEqual([{ id: "1", title: "Toy", updatedAt: "2026-11-25T08:00:00Z" }]);
    expect(second).toEqual(first);
    expect(admin.graphql).toHaveBeenCalledTimes(1);

    now += 30_000;
    const third = await getCachedCatalogProducts(shop, admin, () => now);
    expect(third).toEqual(first);
    expect(admin.graphql).toHaveBeenCalledTimes(1);

    now += 31_000;
    await getCachedCatalogProducts(shop, admin, () => now);
    expect(admin.graphql).toHaveBeenCalledTimes(2);
  });

  it("refreshes immediately after webhook invalidation", async () => {
    const admin = makeAdmin();
    await getCachedCatalogProducts(shop, admin, () => 1_000);
    expect(admin.graphql).toHaveBeenCalledTimes(1);

    invalidateCatalogProductsCache(shop);
    await getCachedCatalogProducts(shop, admin, () => 1_500);
    expect(admin.graphql).toHaveBeenCalledTimes(2);
  });
});
