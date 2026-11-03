import type { DocumentReference, DocumentSnapshot } from "firebase-admin/firestore";

export const PUBLIC_MONITORING_FIELDS = ["meta", "fields", "vector_text", "alertId", "imageUrl", "embeddingSourceUrl", "vector_image"];
type Facts = Record<string, unknown>;
type Entry = { promise: Promise<Facts>; resolve: (data: Facts) => void; reject: (error: unknown) => void; done: boolean; bytes: number; expires: number };
function version(doc: DocumentSnapshot): string {
  if (!doc.exists || !doc.updateTime) throw new Error("Safety Gate source is missing its revision");
  return `${doc.updateTime.seconds}:${doc.updateTime.nanoseconds}`;
}

/** Instance-local PUBLIC data only. Metadata probes remain fresh; native updateTime
 * invalidates every corrected source/re-embedded image, including sub-millisecond writes.
 * Other instances/cold starts read independently. This is not a fleet-wide singleton.
 */
export function createPublicMonitoringCache(
  limits = { maxEntries: 4096, maxBytes: 64 * 1024 * 1024, ttlMs: 10 * 60 * 1000 },
  now = Date.now,
) {
  const cache = new Map<string, Entry>();
  let bytes = 0, completed = 0;
  const drop = (key: string, entry: Entry) => {
    if (cache.get(key) !== entry) return;
    cache.delete(key);
    if (entry.done) { bytes -= entry.bytes; completed--; }
  };
  const prune = () => {
    for (const [key, entry] of cache) {
      if (!entry.done) continue;
      if (entry.expires <= now() || bytes > limits.maxBytes || completed > limits.maxEntries) drop(key, entry);
    }
  };
  return { async load(probes: DocumentSnapshot[], fetch: (refs: DocumentReference[]) => Promise<DocumentSnapshot[]>) {
    // Reject private paths before ANY lookup, fetch or cache mutation.
    for (const doc of probes) if (!/^(rapex_alerts|rapex_alert_images)\/[^/]+$/.test(doc.ref.path)) throw new Error("Only public Safety Gate sources may be shared");
    const identities = probes.map(doc => ({ doc, revision: version(doc), key: `${doc.ref.path}@${version(doc)}` }));
    prune();
    const missing: Array<{ doc: DocumentSnapshot; revision: string; key: string; entry: Entry }> = [];
    const entries = identities.map(identity => {
      const existing = cache.get(identity.key);
      if (existing) return existing;
      let resolve!: Entry["resolve"], reject!: Entry["reject"];
      const promise = new Promise<Facts>((yes, no) => { resolve = yes; reject = no; });
      const entry: Entry = { promise, resolve, reject, done: false, bytes: 0, expires: 0 };
      cache.set(identity.key, entry); missing.push({ ...identity, entry });
      return entry;
    });
    const fill = async () => {
      for (let offset = 0; offset < missing.length; offset += 100) {
        const group = missing.slice(offset, offset + 100);
        try {
          const docs = new Map((await fetch(group.map(item => item.doc.ref))).map(doc => [doc.ref.path, doc]));
          for (const item of group) {
            const doc = docs.get(item.doc.ref.path);
            if (!doc || version(doc) !== item.revision) throw new Error("Safety Gate source changed during preparation; retry monitoring");
            // Defend the shared cache even if a caller mistakenly reads extra fields.
            const raw = doc.data() || {};
            const data = Object.fromEntries(PUBLIC_MONITORING_FIELDS.filter(field => raw[field] !== undefined).map(field => [field, raw[field]]));
            item.entry.bytes = Buffer.byteLength(JSON.stringify(data));
            item.entry.expires = now() + limits.ttlMs;
            item.entry.done = true;
            bytes += item.entry.bytes; completed++;
            item.entry.resolve(data);
          }
          prune();
        } catch (error) {
          for (const { key, entry } of missing.slice(offset)) if (!entry.done) { drop(key, entry); entry.reject(error); }
          return;
        }
      }
    };
    const filling = fill();
    const facts = await Promise.all(entries.map(entry => entry.promise));
    await filling;
    return probes.map((doc, i) => ({ id: doc.id, data: facts[i] }));
  } };
}

export const publicMonitoringCache = createPublicMonitoringCache();
