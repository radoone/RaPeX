import { imageUrls } from "./product-images";

type Admin = { graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response> };

export async function loadAllProductImages(admin: Admin, productId: string): Promise<string[] | null> {
  const images: unknown[] = [], cursors = new Set<string>();
  let after: string | null = null;
  let version: string | undefined;
  do {
    const response = await admin.graphql(`#graphql
      query ReviewProductImages($id: ID!, $after: String) {
        product(id: $id) {
          id updatedAt
          images(first: 100, after: $after) { nodes { url } pageInfo { hasNextPage endCursor } }
        }
      }`, { variables: { id: productId, after } });
    const body = await response.json();
    if (!response.ok || body.errors?.length) throw new Error("Product images unavailable");
    const product = body.data?.product;
    if (product === null && !after) return null;
    if (!product?.images?.nodes || !product.images.pageInfo || product.id !== productId)
      throw new Error("Incomplete product images response");
    if (version && version !== product.updatedAt) throw new Error("Product changed while loading images");
    version = product.updatedAt;
    images.push(...product.images.nodes);
    const page = product.images.pageInfo;
    if (!page.hasNextPage) return imageUrls(images);
    if (!page.endCursor || cursors.has(page.endCursor)) throw new Error("Incomplete product image pagination");
    after = page.endCursor;
    cursors.add(after!);
  } while (after);
  throw new Error("Incomplete product images");
}
