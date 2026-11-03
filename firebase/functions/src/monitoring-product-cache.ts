/** Facts needed by matching and version/deletion fences; search vectors stay on the server. */
export const MONITORING_PRODUCT_FIELDS = [
  "shop", "productId", "productTitle", "productHandle", "name", "category", "description",
  "imageUrl", "imageUrls", "brand", "model", "barcodes", "sourceUpdatedAt", "deletedAt",
];
export type MonitoringProductHit = { id: string; sourceUpdatedAt: unknown };
type ProductFacts = Record<string, unknown>;
type Entry = {
  promise: Promise<ProductFacts | undefined>;
  resolve: (data: ProductFacts | undefined) => void;
  reject: (error: unknown) => void;
  done: boolean;
  bytes: number;
};

/** One shop/page only. Share pending reads as well as completed, versioned facts.
 * Bound retained facts by count and bytes; never evict an in-flight promise.
 */
export function createMonitoringProductCache(
  fetch: (ids: string[]) => Promise<Array<{ id: string; data: ProductFacts }>>,
  limits = { maxEntries: 2048, maxBytes: 16 * 1024 * 1024 },
) {
  const cache = new Map<string, Entry>();
  let retainedBytes = 0;
  let completedEntries = 0;
  const prune = () => {
    for (const [key, entry] of cache) {
      if (retainedBytes <= limits.maxBytes && completedEntries <= limits.maxEntries) break;
      if (!entry.done) continue;
      cache.delete(key);
      retainedBytes -= entry.bytes;
      completedEntries--;
    }
  };

  return async (hits: MonitoringProductHit[]): Promise<Map<string, ProductFacts>> => {
    const missing: Array<{ key: string; hit: MonitoringProductHit; entry: Entry }> = [];
    const entries = hits.map(hit => {
      const key = JSON.stringify([hit.id, typeof hit.sourceUpdatedAt, hit.sourceUpdatedAt]);
      const existing = cache.get(key);
      if (existing) return existing;
      let resolve!: Entry["resolve"];
      let reject!: Entry["reject"];
      const promise = new Promise<ProductFacts | undefined>((yes, no) => { resolve = yes; reject = no; });
      const entry: Entry = { promise, resolve, reject, done: false, bytes: 0 };
      cache.set(key, entry);
      missing.push({ key, hit, entry });
      return entry;
    });
    const populate = async () => {
      for (let offset = 0; offset < missing.length; offset += 100) {
        const batch = missing.slice(offset, offset + 100);
        try {
          const documents = new Map((await fetch([...new Set(batch.map(item => item.hit.id))])).map(doc => [doc.id, doc.data]));
          for (const { hit, entry } of batch) {
            const current = documents.get(hit.id);
            // A changed/deleted document cannot be combined with an older search hit.
            const data = current && !current.deletedAt && current.sourceUpdatedAt === hit.sourceUpdatedAt ? current : undefined;
            entry.bytes = data ? Buffer.byteLength(JSON.stringify(data)) : 0;
            entry.done = true;
            retainedBytes += entry.bytes;
            completedEntries++;
            entry.resolve(data);
          }
          prune();
        } catch (error) {
          // Failed reads remain retryable. Settle every not-yet-fetched promise.
          for (const { key, entry } of missing.slice(offset)) {
            if (!entry.done) {
              if (cache.get(key) === entry) cache.delete(key);
              entry.reject(error);
            }
          }
          return;
        }
      }
    };
    const filling = populate();
    const facts = await Promise.all(entries.map(entry => entry.promise));
    await filling;
    return new Map(hits.flatMap((hit, index) => facts[index] ? [[hit.id, facts[index]!] as const] : []));
  };
}
