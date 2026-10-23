export function exclusionPreview<
  T extends { vendor?: string; productType?: string },
>(products: T[], vendors: string, types: string) {
  const split = (value: string) =>
    value
      .split(",")
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean);
  const vendorRules = split(vendors),
    typeRules = split(types);
  return products.filter(
    (product) =>
      vendorRules.includes((product.vendor || "").trim().toLowerCase()) ||
      typeRules.includes((product.productType || "").trim().toLowerCase()),
  );
}
