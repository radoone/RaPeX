import { sameProductVersion } from "./product-lifecycle.js";

export type CatalogIdentity = { id: string; updatedAt: string };
export type CatalogSnapshot = { id: string; sourceUpdatedAt?: string; deletedAt?: unknown; deletedSourceUpdatedAt?: string; deletionCleanupCompletedAt?: unknown };
export type CatalogRepair = { id: string; operation: "upsert" | "delete"; sourceUpdatedAt: string };
export type ReconciliationPage = {
  phase: "discover" | "verify";
  nextCursor: string | null;
  lastProductId: string | null;
  done: boolean;
  visited: number;
  repairs: CatalogRepair[];
};

/** Drain each bounded dispatch window before a failed page releases its lease. */
export async function dispatchCatalogRepairs<T>(items: T[], work: (item: T) => Promise<void>): Promise<void> {
  for (let offset = 0; offset < items.length; offset += 4) {
    const results = await Promise.allSettled(items.slice(offset, offset + 4).map(work));
    const failure = results.find(result => result.status === "rejected");
    if (failure?.status === "rejected") throw failure.reason;
  }
}

export function catalogProductIdentity(value: unknown): CatalogIdentity {
  const node = value as Record<string, unknown> | null;
  if (!node || typeof node.id !== "string" || !/^gid:\/\/shopify\/Product\/[1-9]\d*$/.test(node.id) ||
    typeof node.updatedAt !== "string" || !Number.isFinite(Date.parse(node.updatedAt))) {
    throw new Error("Shopify catalog product identity is incomplete");
  }
  return { id: node.id.slice("gid://shopify/Product/".length), updatedAt: new Date(node.updatedAt).toISOString() };
}

/** Only explicit nulls in a complete, error-free nodes response mean deletion. */
export function parseCatalogNodes(payload: any, ids: string[]): Map<string, CatalogIdentity | null> {
  if (payload?.errors?.length || !Array.isArray(payload?.data?.nodes) || payload.data.nodes.length !== ids.length) {
    throw new Error("Shopify product existence response is incomplete");
  }
  const result = new Map<string, CatalogIdentity | null>();
  payload.data.nodes.forEach((node: unknown, index: number) => {
    const identity = node === null ? null : catalogProductIdentity(node);
    if (identity && identity.id !== ids[index]) throw new Error("Shopify product existence response has a different identity");
    result.set(ids[index], identity);
  });
  return result;
}

export function parseCatalogPage(payload: any, cursor: string | null, previousId: string | null): {
  products: CatalogIdentity[]; cursor: string | null; lastProductId: string | null; done: boolean;
} {
  const connection = payload?.data?.products;
  if (payload?.errors?.length || !Array.isArray(connection?.nodes) || connection.nodes.length > 100 ||
    typeof connection?.pageInfo?.hasNextPage !== "boolean") throw new Error("Shopify catalog page is incomplete");
  const products = connection.nodes.map(catalogProductIdentity) as CatalogIdentity[];
  let lastProductId = previousId;
  for (const product of products) {
    if (lastProductId && BigInt(product.id) <= BigInt(lastProductId)) throw new Error("Shopify catalog pagination did not advance");
    lastProductId = product.id;
  }
  const nextCursor = connection.pageInfo.endCursor;
  const done = !connection.pageInfo.hasNextPage;
  if (!done && (!products.length || typeof nextCursor !== "string" || !nextCursor || nextCursor === cursor)) {
    throw new Error("Shopify catalog page did not include a new cursor");
  }
  return { products, cursor: done ? null : nextCursor, lastProductId, done };
}

export function catalogNeedsRepair(stored: CatalogSnapshot | undefined, current: CatalogIdentity): boolean {
  if (!stored) return true;
  if (Date.parse(stored.sourceUpdatedAt || "") > Date.parse(current.updatedAt)) return false;
  if (stored.deletedAt && Date.parse(stored.deletedSourceUpdatedAt || "") >= Date.parse(current.updatedAt)) return false;
  return Boolean(stored.deletedAt) || !sameProductVersion(stored.sourceUpdatedAt, current.updatedAt);
}

export function prepareCatalogVerification(
  stored: CatalogSnapshot[], current: Map<string, CatalogIdentity | null>, observedAt: string, entitled: boolean,
): CatalogRepair[] {
  if (!Number.isFinite(Date.parse(observedAt))) throw new Error("Invalid catalog observation time");
  const repairs: CatalogRepair[] = [];
  for (const product of stored) {
    if (!current.has(product.id)) throw new Error("Shopify product existence response is incomplete");
    const node = current.get(product.id);
    if (node) {
      if (entitled && catalogNeedsRepair(product, node)) repairs.push({ id: product.id, operation: "upsert", sourceUpdatedAt: node.updatedAt });
    } else if (!product.deletedAt) {
      // A clock-skewed/newer local version must never be overwritten by older absence evidence.
      if (Date.parse(product.sourceUpdatedAt || "") > Date.parse(observedAt)) continue;
      repairs.push({ id: product.id, operation: "delete", sourceUpdatedAt: observedAt });
    } else if (!product.deletionCleanupCompletedAt && product.deletedSourceUpdatedAt) {
      repairs.push({ id: product.id, operation: "delete", sourceUpdatedAt: product.deletedSourceUpdatedAt });
    }
  }
  return repairs;
}
