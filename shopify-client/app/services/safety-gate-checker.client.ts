import type { ProductVariant } from "@shopify/hydrogen/storefront-api-types";

export interface ProductData {
  name: string;
  category: string;
  description: string;
  imageUrl?: string;
  brand?: string;
  model?: string;
}

/**
 * Convert Shopify Product to ProductData for Safety Gate checking
 * This function can run on both client and server
 */
export function shopifyProductToProductData(product: any, selectedVariant?: ProductVariant): ProductData {
  // Extract category from product type or tags
  const category = product.productType ||
    product.tags?.find((tag: string) =>
      ['toys', 'electronics', 'clothing', 'cosmetics', 'food', 'jewelry'].includes(tag.toLowerCase())
    ) ||
    'general';

  // Build description from product description and variant info
  let description = product.description || product.descriptionHtml?.replace(/<[^>]*>/g, '') || product.title;

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
    product.tags?.find((tag: string) => tag.toLowerCase().includes('brand:'))?.replace(/brand:\s*/i, '');

  return {
    name: product.title,
    category: category.toLowerCase(),
    description,
    imageUrl: product.featuredImage?.url || selectedVariant?.image?.url,
    brand,
    model: selectedVariant?.title !== product.title ? selectedVariant?.title : undefined,
  };
}
