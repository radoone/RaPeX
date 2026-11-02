/** Preserve every distinct photograph, including legacy Safety Gate representations. */
export function imageUrls(...values: unknown[]): string[] {
  const urls = values.flatMap((value): unknown[] => Array.isArray(value) ? value : [value])
    .map(value => typeof value === "string" ? value :
      value && typeof value === "object" ? (value as { url?: unknown; src?: unknown }).url || (value as { src?: unknown }).src : null)
    .filter((value): value is string => typeof value === "string")
    .map(value => value.trim())
    .filter(value => {
      try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password; }
      catch { return false; }
    });
  return [...new Set(urls)];
}

export function warningImages(warning: any): string[] {
  const fields = warning?.alertDetails?.fields || {};
  return imageUrls(warning?.referenceImageUrls, fields.pictures, fields.product_image,
    typeof fields.product_other_images === "string" ? fields.product_other_images.split(",") : fields.product_other_images);
}
