type ProductCheckVersion = {
  sourceUpdatedAt?: string | null;
  checkedAt?: Date | string | null;
};

function parseTimestamp(value: Date | string | null | undefined): number | null {
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
    return check.sourceUpdatedAt === productUpdatedAt;
  }

  // Legacy check documents do not contain the product version. Count one only
  // when its completion time is at or after the current Shopify update time.
  const checkedAt = parseTimestamp(check.checkedAt);
  const productVersion = parseTimestamp(productUpdatedAt);
  return checkedAt !== null && productVersion !== null && checkedAt >= productVersion;
}
