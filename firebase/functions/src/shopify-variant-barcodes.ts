import { normalizeProductBarcodes, type ProductBarcode } from "./product-barcodes.js";

type Request = (query: string, variables: Record<string, unknown>) => Promise<any>;

/** Traverse every variant; a changed product or broken page is an incomplete import. */
export async function completeShopifyBarcodes(product: any, request: Request): Promise<ProductBarcode[]> {
  let connection = product.variants;
  const barcodes: ProductBarcode[] = [];
  const cursors = new Set<string>();
  if (!connection || (!Array.isArray(connection.nodes) && !Array.isArray(connection.edges))) throw new Error("Shopify did not return variant barcodes");
  while (connection) {
    if (!Array.isArray(connection.nodes) && !Array.isArray(connection.edges)) throw new Error("Shopify did not return variant barcodes");
    if (typeof connection.pageInfo?.hasNextPage !== "boolean") throw new Error("Shopify did not return variant pagination");
    const variants = connection.nodes || connection.edges?.map((edge: any) => edge.node) || [];
    for (const variant of variants) {
      if (typeof variant.barcode === "string" && variant.barcode.trim()) {
        barcodes.push({ barcode: variant.barcode.trim(), variantId: String(variant.id), variantTitle: String(variant.title || "") });
      }
    }
    if (!connection.pageInfo?.hasNextPage) break;
    const cursor = connection.pageInfo.endCursor;
    if (typeof cursor !== "string" || !cursor || cursors.has(cursor)) throw new Error("Shopify variant cursor is missing or repeated");
    cursors.add(cursor);
    const payload = await request(`query ProductBarcodeVariants($id: ID!, $after: String) {
      product(id: $id) { id updatedAt variants(first: 250, after: $after) {
        nodes { id title barcode } pageInfo { hasNextPage endCursor }
      } }
    }`, { id: product.id, after: cursor });
    if (payload.errors?.length || !payload.data?.product?.variants) throw new Error("Could not load Shopify variant barcodes");
    if (payload.data.product.updatedAt !== product.updatedAt) throw new Error("Shopify product changed during variant import; retry");
    connection = payload.data.product.variants;
  }
  return normalizeProductBarcodes(barcodes);
}
