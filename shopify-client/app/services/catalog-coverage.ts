export type ProductCheckVersion = {
  sourceUpdatedAt?: string | null;
  checkedAt?: Date | string | null;
};

export function sameProductVersion(left: unknown, right: unknown): boolean {
  const first = typeof left === "string" ? Date.parse(left) : NaN;
  const second = typeof right === "string" ? Date.parse(right) : NaN;
  return Number.isFinite(first) && first === second;
}

function parseTimestamp(
  value: Date | string | null | undefined,
): number | null {
  if (value instanceof Date) {
    const parsed = value.getTime();
    return Number.isFinite(parsed) ? parsed : null;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

/** A saved result covers only the exact Shopify product version it checked. */
export function checkCoversCurrentProductVersion(
  check: ProductCheckVersion | undefined,
  productUpdatedAt: string | null | undefined,
): boolean {
  if (!check || !productUpdatedAt) return false;

  if (check.sourceUpdatedAt) {
    return sameProductVersion(check.sourceUpdatedAt, productUpdatedAt);
  }

  // Legacy check documents do not contain the product version. Count one only
  // when its completion time is at or after the current Shopify update time.
  const checkedAt = parseTimestamp(check.checkedAt);
  const productVersion = parseTimestamp(productUpdatedAt);
  return (
    checkedAt !== null && productVersion !== null && checkedAt >= productVersion
  );
}
