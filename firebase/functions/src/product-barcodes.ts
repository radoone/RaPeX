import { canonicalGtin, extractGtins } from "./gtin.js";

export type ProductBarcode = { barcode: string; variantId?: string; variantTitle?: string };
export type BarcodeMatch = ProductBarcode & { gtin: string; alertBarcode: string };

/** Keep variant provenance; never infer a GTIN from a SKU or product title. */
export function normalizeProductBarcodes(value: unknown): ProductBarcode[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.flatMap((item) => {
    if (!item || !canonicalGtin(item.barcode)) return [];
    const barcode = item.barcode.trim();
    const variantId = typeof item.variantId === "string" ? item.variantId.trim() : "";
    const variantTitle = typeof item.variantTitle === "string" ? item.variantTitle.trim() : "";
    const key = `${variantId}\0${canonicalGtin(barcode)}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ barcode, ...(variantId ? { variantId } : {}), ...(variantTitle ? { variantTitle } : {}) }];
  });
}

export function productGtins(barcodes: unknown): string[] {
  return [...new Set(normalizeProductBarcodes(barcodes).map((item) => canonicalGtin(item.barcode)!))].sort();
}

export function alertGtins(fields: Record<string, unknown> = {}): string[] {
  return [...new Set([...extractGtins(fields.barcode), ...extractGtins(fields.product_barcode)])].sort();
}

export function findBarcodeMatches(barcodes: unknown, fields: Record<string, unknown> = {}): BarcodeMatch[] {
  return normalizeProductBarcodes(barcodes).flatMap((item) => {
    const gtin = canonicalGtin(item.barcode)!;
    const source = [fields.barcode, fields.product_barcode].find((value) => extractGtins(value).includes(gtin));
    const alertBarcode = typeof source === "string"
      ? source.match(/(?<!\d)\d{8,14}(?!\d)/g)?.find((code) => canonicalGtin(code) === gtin) : undefined;
    return alertBarcode ? [{ ...item, gtin, alertBarcode }] : [];
  });
}
