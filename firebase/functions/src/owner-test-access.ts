/** Private owner-issued access, separate from Shopify subscriptions. Deny malformed grants. */
export function ownerTestAccessGranted(data: Record<string, any>, shop: string, now = Date.now()): boolean {
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop) || data.installationRetiredAt) return false;
  const grant = data.ownerTestAccess;
  if (!grant || grant.enabled !== true || grant.shop !== shop) return false;
  const installation = String(data.createdAt?.toMillis?.() ?? data.createdAt ?? "legacy");
  if (grant.installation !== installation) return false;
  if (grant.expiresAt === null) return true; // Explicit owner choice: until revoked.
  try {
    const expiry = grant.expiresAt?.toMillis?.() ?? (grant.expiresAt instanceof Date ? grant.expiresAt.getTime() : NaN);
    return Number.isFinite(expiry) && expiry > now;
  } catch { return false; }
}
