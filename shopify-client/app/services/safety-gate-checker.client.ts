import type { ProductVariant } from "../types/product";

export interface ProductData {
  name: string;
  category: string;
  description: string;
  imageUrl?: string;
  imageUrls?: string[];
  brand?: string;
  model?: string;
}

function pickImageUrl(candidate: any): string | undefined {
  if (!candidate) {
    return undefined;
  }

  if (typeof candidate === "string") {
    return candidate.trim() || undefined;
  }

  const url = candidate.url || candidate.src || candidate.originalSrc;
  return typeof url === "string" && url.trim() ? url.trim() : undefined;
}

function collectImageUrls(product: any, selectedVariant?: ProductVariant): string[] {
  const candidates = [
    pickImageUrl(product?.featuredImage),
    pickImageUrl(product?.image),
    ...(Array.isArray(product?.images) ? product.images.map(pickImageUrl) : []),
    ...(Array.isArray(product?.images?.nodes) ? product.images.nodes.map(pickImageUrl) : []),
    ...(Array.isArray(product?.images?.edges) ? product.images.edges.map((edge: any) => pickImageUrl(edge?.node)) : []),
    pickImageUrl(selectedVariant?.image),
    ...(Array.isArray(product?.variants)
      ? product.variants.map((variant: any) => pickImageUrl(variant?.image))
      : []),
    ...(Array.isArray(product?.variants?.edges)
      ? product.variants.edges.map((edge: any) => pickImageUrl(edge?.node?.image))
      : []),
  ];

  return [...new Set(candidates.filter((url): url is string => Boolean(url)))].slice(0, 4);
}

function normalizeTags(tags: unknown): string[] {
  if (Array.isArray(tags)) {
    return tags.filter((tag): tag is string => typeof tag === "string");
  }

  if (typeof tags === "string") {
    return tags
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);
  }

  return [];
}

function stripHtml(value: unknown): string | undefined {
  return typeof value === "string" ? value.replace(/<[^>]*>/g, "").trim() : undefined;
}

/**
 * Convert Shopify Product to ProductData for Safety Gate checking
 * This function can run on both client and server
 */
export function shopifyProductToProductData(product: any, selectedVariant?: ProductVariant): ProductData {
  const tags = normalizeTags(product?.tags);

  // Extract category from product type or tags
  const category = product.productType ||
    product.product_type ||
    tags.find((tag) =>
      ['toys', 'electronics', 'clothing', 'cosmetics', 'food', 'jewelry'].includes(tag.toLowerCase())
    ) ||
    'general';

  // Build description from product description and variant info
  let description =
    stripHtml(product.description) ||
    stripHtml(product.descriptionHtml) ||
    stripHtml(product.body_html) ||
    product.title ||
    "";

  if (selectedVariant) {
    const variantInfo = selectedVariant.selectedOptions
      ?.map(option => `${option.name}: ${option.value}`)
      .join(', ');

    if (variantInfo) {
      description += ` (${variantInfo})`;
    }
  }

  // Try to extract brand from vendor, title, or tags
  const brand = product.vendor ||
    tags.find((tag) => tag.toLowerCase().includes('brand:'))?.replace(/brand:\s*/i, '');

  const imageUrls = collectImageUrls(product, selectedVariant);

  return {
    name: product.title || "Untitled product",
    category: category.toLowerCase(),
    description,
    imageUrl: imageUrls[0],
    imageUrls,
    brand,
    model: selectedVariant?.title !== product.title ? selectedVariant?.title : undefined,
  };
}
