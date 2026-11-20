import { imageUrls } from "./product-images";

/** Use fetch rather than route navigation so a failed photo refresh stays local. */
export async function fetchReviewPhotos(productId: string, signal: AbortSignal, request: typeof fetch = fetch): Promise<string[]> {
  const response = await request(`/api/product-images?productId=${encodeURIComponent(productId)}`, { signal });
  if (!response.ok) throw new Error("Product photographs unavailable");
  const result = await response.json();
  if (result.error || result.productId !== productId || !Array.isArray(result.images)) throw new Error("Invalid product photographs");
  return imageUrls(result.images);
}
