import type { Readable } from "node:stream";
import type { CollectionReference, QueryDocumentSnapshot } from "firebase-admin/firestore";
import { MONITORING_PRODUCT_FIELDS } from "./monitoring-product-cache.js";
import { alertGtins } from "./product-barcodes.js";
import { MATCHING_THRESHOLDS } from "./safety-gate-config.js";

// Conservative runtime/cost limits, not commercial plan sizes. Include tombstones in the cap.
export const SMALL_CATALOG_LIMITS = { maxProducts: 250, maxBytes: 16 * 1024 * 1024, minSearches: 16 };
type Source = { alert: { fields: Record<string, unknown> }; textVector?: number[]; images?: Array<{ vector: number[]; mediaUrl: string }> };
type Candidate = { id: string; data: Record<string, unknown>; matchedImageUrls?: string[] };
type Vector = { values: number[]; norm: number };
type Product = { id: string; data: Record<string, unknown>; gtins: string[]; text?: Vector; image?: Vector };
const EPSILON = 1e-6;
const compareIds = (a: string, b: string) => Buffer.compare(Buffer.from(a), Buffer.from(b));
function vector(value: unknown): Vector | undefined {
  if (value === undefined || value === null) return undefined;
  // Firestore KNN indexes native vectors, not plain array fields.
  if (typeof (value as { toArray?: unknown }).toArray !== "function") throw new Error("Invalid vector encoding");
  const values = (value as { toArray(): number[] }).toArray();
  if (!values.length || values.length > 2048 || values.some(n => !Number.isFinite(n))) throw new Error("Invalid vector values");
  const norm = Math.sqrt(values.reduce((sum, n) => sum + n * n, 0));
  if (!Number.isFinite(norm) || norm === 0) throw new Error("Invalid vector norm");
  return { values, norm };
}

/** Exact cosine scan of a complete bounded snapshot. Null requests authoritative KNN
 * near a numerical cutoff; it never means an empty/clean result.
 */
function createCatalog(products: Product[]) {
  const rows = [...products].sort((a, b) => compareIds(a.id, b.id));
  return { retrieve(source: Source): Candidate[] | null {
    if (!source.textVector?.length) throw new Error("Safety Gate text vector is unavailable");
    const found = new Map<string, Candidate>();
    const codes = alertGtins(source.alert.fields);
    for (let offset = 0; offset < codes.length; offset += 30) {
      const group = codes.slice(offset, offset + 30);
      for (const row of rows) if (row.gtins.some(code => group.includes(code))) found.set(row.id, { id: row.id, data: row.data });
    }
    const searches = [
      { field: "text" as const, values: source.textVector, maxDistance: MATCHING_THRESHOLDS.textDistance, url: undefined as string | undefined },
      ...(source.images || []).map(image => ({ field: "image" as const, values: image.vector, maxDistance: MATCHING_THRESHOLDS.imageDistance, url: image.mediaUrl })),
    ];
    const scores = new Map<string, Map<string, number>>();
    for (const search of searches) {
      if (!search.values.length) continue;
      const norm = Math.sqrt(search.values.reduce((sum, n) => sum + n * n, 0));
      if (!Number.isFinite(norm) || norm === 0) return null;
      const matches: Array<{ row: Product; distance: number }> = [];
      for (const row of rows) {
        const stored = row[search.field];
        if (!stored || stored.values.length !== search.values.length) continue;
        let dot = 0;
        for (let i = 0; i < stored.values.length; i++) dot += stored.values[i] * search.values[i];
        const distance = 1 - dot / (norm * stored.norm);
        if (!Number.isFinite(distance) || Math.abs(distance - search.maxDistance) <= EPSILON) return null;
        if (distance <= search.maxDistance) matches.push({ row, distance });
      }
      matches.sort((a, b) => a.distance - b.distance || compareIds(a.row.id, b.row.id));
      for (const { row, distance } of matches) {
        const candidate = found.get(row.id) || { id: row.id, data: row.data };
        if (search.url) {
          const images = scores.get(row.id) || new Map<string, number>();
          images.set(search.url, Math.min(images.get(search.url) ?? Infinity, distance));
          // Close but unequal image scores can sort differently in Firestore arithmetic.
          const distances = [...images.values()].sort((a, b) => a - b);
          if (distances.some((d, i) => i > 0 && d !== distances[i - 1] && d - distances[i - 1] <= EPSILON)) return null;
          scores.set(row.id, images);
          candidate.matchedImageUrls = [...images].sort((a, b) => a[1] - b[1]).map(([url]) => url);
        }
        found.set(row.id, candidate);
      }
    }
    return [...found.values()];
  } };
}

/** Count at most cap+1 first: large catalogs never download their vectors to probe size.
 * A streamed, complete snapshot catches growth and enforces a byte cap. Read failures
 * propagate; a bounded/unsupported snapshot falls back to the existing Firestore finder.
 */
export async function loadSmallMonitoringCatalog(
  collection: CollectionReference, sources: Source[], limits = SMALL_CATALOG_LIMITS,
) {
  const searches = sources.reduce((sum, source) => sum + 1 + (source.images?.length || 0), 0);
  const fallback = (reason: string, productCount?: number, bytes?: number) => ({ catalog: null, reason, productCount, bytes, searches });
  if (searches < limits.minSearches) return fallback("small-batch");
  const count = (await collection.limit(limits.maxProducts + 1).count().get()).data().count;
  if (count > limits.maxProducts) return fallback("product-limit", count);
  // Avoid fetching a whole catalog for a small amount of indexed work. This is a
  // conservative heuristic, not a prediction of billed index/document reads.
  if (searches * 4 < count) return fallback("small-batch", count);
  const stream = collection.select(...MONITORING_PRODUCT_FIELDS, "gtins", "vector_text", "vector_image")
    .limit(limits.maxProducts + 1).stream() as Readable;
  const products: Product[] = [];
  let documents = 0, bytes = 0;
  try {
    for await (const value of stream) {
      const doc = value as unknown as QueryDocumentSnapshot;
      documents++;
      if (documents > limits.maxProducts) return fallback("catalog-grew", documents, bytes);
      const data = doc.data() as Record<string, unknown>;
      bytes += Buffer.byteLength(JSON.stringify(data));
      if (bytes > limits.maxBytes) return fallback("byte-limit", documents, bytes);
      if (data.deletedAt) continue;
      let text: Vector | undefined, image: Vector | undefined;
      try { text = vector(data.vector_text); image = vector(data.vector_image); }
      catch { return fallback("unsupported-vector", documents, bytes); }
      products.push({ id: doc.id, text, image,
        gtins: Array.isArray(data.gtins) ? data.gtins.filter((code): code is string => typeof code === "string") : [],
        data: Object.fromEntries(MONITORING_PRODUCT_FIELDS.filter(field => data[field] !== undefined).map(field => [field, data[field]])),
      });
    }
  } finally { stream.destroy(); }
  return { catalog: createCatalog(products), reason: "bounded-snapshot", productCount: documents, bytes, searches };
}
