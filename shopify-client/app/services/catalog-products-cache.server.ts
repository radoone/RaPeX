export type DashboardCatalogProduct = {
  id: string;
  title: string;
  updatedAt: string | null;
};

type AdminGraphql = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<{ json: () => Promise<any> }>;
};

const CATALOG_CACHE_TTL_MS = 60_000;
const catalogCache = new Map<
  string,
  { products: DashboardCatalogProduct[]; expiresAt: number }
>();
const pendingCatalogFetches = new Map<
  string,
  Promise<DashboardCatalogProduct[]>
>();

export function invalidateCatalogProductsCache(shop?: string): void {
  if (shop) {
    catalogCache.delete(shop);
    pendingCatalogFetches.delete(shop);
  } else {
    catalogCache.clear();
    pendingCatalogFetches.clear();
  }
}

async function fetchCurrentCatalogProductsFromShopify(
  admin: AdminGraphql,
): Promise<DashboardCatalogProduct[]> {
  const products: DashboardCatalogProduct[] = [];
  let after: string | null = null;
  let hasNextPage = true;
  while (hasNextPage) {
    const response = await admin.graphql(
      `#graphql
      query dashboardCatalogProducts($first: Int!, $after: String) {
        products(first: $first, after: $after) {
          pageInfo { hasNextPage endCursor }
          nodes { id title updatedAt }
        }
      }
    `,
      { variables: { first: 250, after } },
    );
    const payload = await response.json();
    if (payload.errors?.length) {
      throw new Error(
        payload.errors[0]?.message || "Could not load Shopify catalog versions",
      );
    }
    const connection = payload.data?.products;
    const nodes = (connection?.nodes || []) as Array<{
      id: string;
      title: string;
      updatedAt?: string | null;
    }>;
    products.push(
      ...nodes.map((product) => ({
        id: product.id.replace("gid://shopify/Product/", ""),
        title: product.title,
        updatedAt: product.updatedAt || null,
      })),
    );
    hasNextPage = Boolean(connection?.pageInfo?.hasNextPage);
    after = connection?.pageInfo?.endCursor || null;
    if (hasNextPage && !after) {
      throw new Error("Shopify catalog page did not include its next cursor");
    }
  }
  return products;
}

export async function getCachedCatalogProducts(
  shop: string,
  admin: AdminGraphql,
  now = Date.now,
): Promise<DashboardCatalogProduct[]> {
  const cached = catalogCache.get(shop);
  if (cached && cached.expiresAt > now()) {
    return cached.products;
  }
  const existing = pendingCatalogFetches.get(shop);
  if (existing) return existing;

  const pending = fetchCurrentCatalogProductsFromShopify(admin)
    .then((products) => {
      if (pendingCatalogFetches.get(shop) === pending) {
        catalogCache.set(shop, {
          products,
          expiresAt: now() + CATALOG_CACHE_TTL_MS,
        });
      }
      return products;
    })
    .finally(() => {
      if (pendingCatalogFetches.get(shop) === pending) {
        pendingCatalogFetches.delete(shop);
      }
    });
  pendingCatalogFetches.set(shop, pending);
  return pending;
}
