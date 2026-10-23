import { checkCoversCurrentProductVersion } from "./catalog-coverage";

type Check = {
  productId?: string | null;
  sourceUpdatedAt?: string | null;
  checkedAt?: Date | string | null;
  isSafe?: boolean;
};
export function productCheckState(checks: Check[], updatedAt?: string | null) {
  const latest =
    [...checks].sort(
      (a, b) =>
        new Date(b.checkedAt || 0).getTime() -
        new Date(a.checkedAt || 0).getTime(),
    )[0] || null;
  const current =
    checks.find((check) =>
      checkCoversCurrentProductVersion(check, updatedAt),
    ) || null;
  return {
    latest,
    current,
    state: current ? "current" : latest ? "changed" : "unchecked",
  } as const;
}
export function catalogCheckStates(
  products: Array<{ id: string; updatedAt?: string | null }>,
  checks: Check[],
) {
  const byProduct = new Map<string, Check[]>();
  for (const check of checks) {
    const id = check.productId?.replace("gid://shopify/Product/", "");
    if (id) byProduct.set(id, [...(byProduct.get(id) || []), check]);
  }
  return Object.fromEntries(
    products.map((product) => {
      const id = product.id.replace("gid://shopify/Product/", "");
      return [
        id,
        productCheckState(byProduct.get(id) || [], product.updatedAt),
      ];
    }),
  );
}
