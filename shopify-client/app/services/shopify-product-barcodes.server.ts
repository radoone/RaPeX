/** Complete a product's variant connection before a safety check. */
export async function completeProductBarcodeVariants(admin: { graphql: any }, product: any): Promise<any> {
  let connection = product.variants;
  if (!connection || (!Array.isArray(connection.nodes) && !Array.isArray(connection.edges))) throw new Error("Shopify did not return variant barcodes");
  if (typeof connection.pageInfo?.hasNextPage !== "boolean") throw new Error("Shopify did not return variant pagination");
  const variants = [...(connection?.nodes || connection?.edges?.map((edge: any) => edge.node) || [])];
  const cursors = new Set<string>();
  while (connection?.pageInfo?.hasNextPage) {
    const after = connection.pageInfo.endCursor;
    if (typeof after !== "string" || !after || cursors.has(after)) throw new Error("Shopify variant cursor is missing or repeated");
    cursors.add(after);
    const response = await admin.graphql(`query ProductBarcodeVariants($id: ID!, $after: String) {
      product(id: $id) { id updatedAt variants(first: 250, after: $after) {
        nodes { id title barcode } pageInfo { hasNextPage endCursor }
      } }
    }`, { variables: { id: product.id, after } });
    const payload = await response.json();
    if (payload.errors?.length || !payload.data?.product?.variants) throw new Error("Could not load Shopify variant barcodes");
    if (payload.data.product.updatedAt !== product.updatedAt) throw new Error("Shopify product changed during variant import; retry");
    connection = payload.data.product.variants;
    if (!Array.isArray(connection.nodes) && !Array.isArray(connection.edges)) throw new Error("Shopify did not return variant barcodes");
    if (typeof connection.pageInfo?.hasNextPage !== "boolean") throw new Error("Shopify did not return variant pagination");
    variants.push(...(connection.nodes || connection.edges?.map((edge: any) => edge.node) || []));
  }
  return { ...product, variants: { nodes: variants, pageInfo: { hasNextPage: false } } };
}
