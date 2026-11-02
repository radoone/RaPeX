import { describe, expect, it, vi } from "vitest";
import { shopifyProductToProductData } from "../app/services/safety-gate-product-data";
import { completeProductBarcodeVariants } from "../app/services/shopify-product-barcodes.server";
import { parseEvidence } from "../app/services/review-evidence";

describe("product variant barcodes", () => {
  const variant = { id: "gid://shopify/ProductVariant/1", title: "Blue", barcode: "036000291452", sku: "4006381333931" };
  it("preserves real barcodes and variant identity in REST and GraphQL product shapes", () => {
    for (const variants of [[variant], { nodes: [variant] }, { edges: [{ node: variant }] }]) {
      const result = shopifyProductToProductData({ title: "Product", variants });
      expect(result.barcodes).toEqual([{ barcode: variant.barcode, variantId: variant.id, variantTitle: "Blue" }]);
      expect(result.barcodesComplete).toBe(!Array.isArray(variants));
    }
    expect(shopifyProductToProductData({ title: "Product", variants: [{ id: "1", sku: "036000291452" }] }).barcodes).toEqual([]);
  });
  it("loads beyond the first page and rejects changed products or broken pagination", async () => {
    const product = { id: "gid://shopify/Product/1", updatedAt: "version-1", variants: { nodes: [variant], pageInfo: { hasNextPage: true, endCursor: "cursor" } } };
    const admin = { graphql: vi.fn(async () => ({ json: async () => ({ data: { product: { updatedAt: "version-1", variants: { nodes: [{ ...variant, id: "later" }], pageInfo: { hasNextPage: false } } } } }) })) };
    const complete = await completeProductBarcodeVariants(admin, product);
    expect(shopifyProductToProductData(complete).barcodes?.map(v => v.variantId)).toEqual([variant.id, "later"]);
    expect(admin.graphql).toHaveBeenCalledWith(expect.stringContaining("barcode"), { variables: { id: product.id, after: "cursor" } });
    await expect(completeProductBarcodeVariants({ graphql: async () => ({ json: async () => ({ errors: [{}] }) }) }, product)).rejects.toThrow("Could not load");
    await expect(completeProductBarcodeVariants({ graphql: async () => ({ json: async () => ({ data: { product: { updatedAt: "new", variants: {} } } }) }) }, product)).rejects.toThrow("changed");
    await expect(completeProductBarcodeVariants(admin, { ...product, variants: { nodes: [], pageInfo: { hasNextPage: true } } })).rejects.toThrow("cursor");
    await expect(completeProductBarcodeVariants(admin, { ...product, variants: undefined })).rejects.toThrow("did not return");
  });
  it("keeps exact identifier evidence separate from a percentage similarity", () => {
    const identifierMatches = [{ gtin: "00036000291452", barcode: variant.barcode, alertBarcode: variant.barcode, variantId: variant.id }];
    const evidence = parseEvidence(JSON.stringify({ warnings: [{ matchBasis: "gtin", overallSimilarity: 100, identifierMatches }] }));
    expect(evidence.matchBasis).toBe("gtin");
    expect(evidence.overallSimilarity).toBe("");
    expect(evidence.identifierMatches).toEqual(identifierMatches);
    expect(parseEvidence(JSON.stringify({ warnings: [{ overallSimilarity: 83 }] })).overallSimilarity).toBe(83);
  });
});
