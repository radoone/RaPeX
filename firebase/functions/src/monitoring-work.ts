import { randomUUID } from "node:crypto";
import { FieldValue, Timestamp, type DocumentReference, type Firestore } from "firebase-admin/firestore";
import { installationKey } from "./product-lifecycle.js";
import type { NormalizedAlert } from "./safety-gate-checker.types.js";

export type MonitoringCounts = { productsScanned: number; matchesFound: number; alertsCreated: number };
export type MonitoringProductWork = {
  product: { id: string; data: Record<string, unknown> };
  alerts: Map<string, NormalizedAlert>;
  completed?: MonitoringCounts;
  workKey?: string;
};
export type MonitoringPageSeed = {
  shop: string;
  mode: "delta" | "bootstrap" | "windowed";
  window: { strategy: "since-last-check" | "last-days" | "full-lookback"; days: number | null; checkpointDate: string };
  hasMore: boolean;
  rapexAlertsScanned: number;
  checkpoint: { lastRapexAlertDate: string | null; lastRapexRecordTimestamp: string | null; lastRapexAlertDocId: string | null };
  changeCursor: { id: string; changedAt: string } | null;
};
export type MonitoringPreparedPage = { seed: MonitoringPageSeed; items: MonitoringProductWork[] };

/** Windows bound retained vectors as well as network requests; merge in source order. */
export async function prepareMonitoringShortlist<A, P>(
  sources: A[], retrieve: (source: A) => Promise<P[]>, consume: (source: A, products: P[]) => void,
): Promise<void> {
  for (let offset = 0; offset < sources.length; offset += 4) {
    const window = sources.slice(offset, offset + 4);
    const results = await Promise.allSettled(window.map(retrieve));
    const failure = results.find(result => result.status === "rejected");
    if (failure?.status === "rejected") throw failure.reason;
    results.forEach((result, index) => {
      if (result.status === "fulfilled") consume(window[index], result.value);
    });
  }
}

/** Drain siblings before releasing a run lease after a failed product. */
export async function processMonitoringProducts<T>(items: T[], work: (item: T) => Promise<void>): Promise<void> {
  for (let offset = 0; offset < items.length; offset += 2) {
    const results = await Promise.allSettled(items.slice(offset, offset + 2).map(work));
    const failure = results.find(result => result.status === "rejected");
    if (failure?.status === "rejected") throw failure.reason;
  }
}

/** Immutable prepared page plus per-product commits, scoped below the run/installation.
 * Snapshot only facts and references: never duplicate search vectors or OAuth tokens.
 */
export function createMonitoringWorkStore(db: Firestore, runRef: DocumentReference, merchantRef: DocumentReference, installation: string) {
  const headRef = runRef.collection("monitoring_work_heads").doc("page");
  const assertInstallation = (merchant: { exists: boolean; get: (key: string) => unknown; data: () => Record<string, unknown> | undefined }) => {
    if (!merchant.exists || merchant.get("installationRetiredAt") || installationKey(merchant.data() || {}) !== installation) {
      throw new Error("Merchant installation changed during monitoring work");
    }
  };
  const write = async (rows: Array<{ ref: DocumentReference; data: Record<string, unknown> }>) => {
    for (let offset = 0; offset < rows.length; offset += 50) {
      await db.runTransaction(async transaction => {
        assertInstallation(await transaction.get(merchantRef));
        for (const row of rows.slice(offset, offset + 50)) transaction.set(row.ref, row.data);
      });
    }
  };
  const encode = (value: unknown) => {
    const json = JSON.stringify(value);
    if (Buffer.byteLength(json) > 850_000) throw new Error("Monitoring work snapshot exceeds its safe document size");
    return json;
  };

  const load = async (): Promise<MonitoringPreparedPage | null> => {
    const head = await headRef.get();
    if (!head.exists) return null;
    if (head.get("installation") !== installation) throw new Error("Monitoring work installation mismatch");
    const generation = head.get("generation");
    if (typeof generation !== "string" || !generation) throw new Error("Invalid monitoring work generation");
    const pageRef = runRef.collection("monitoring_work_pages").doc(generation);
    const page = await pageRef.get();
    if (!page.exists || page.get("installation") !== installation) throw new Error("Prepared monitoring page is missing");
    const [sourceRows, productRows] = await Promise.all([
      pageRef.collection("monitoring_work_sources").get(),
      pageRef.collection("monitoring_work_products").get(),
    ]);
    if (sourceRows.size !== page.get("sourceCount") || productRows.size !== page.get("productCount")) {
      throw new Error("Prepared monitoring work is incomplete");
    }
    const sources = new Map<string, NormalizedAlert>(sourceRows.docs.map(doc => [doc.id, JSON.parse(doc.get("json")) as NormalizedAlert]));
    const items = productRows.docs.map(doc => {
      const stored = JSON.parse(doc.get("json")) as {
        product: MonitoringProductWork["product"];
        alerts: Array<{ id: string; fields: Record<string, unknown> }>;
      };
      const alerts = new Map<string, NormalizedAlert>(stored.alerts.map(reference => {
        const source = sources.get(reference.id);
        if (!source) throw new Error("Prepared monitoring source is missing");
        return [source.id, { ...source, fields: { ...source.fields, ...reference.fields } }];
      }));
      return { ...stored, alerts, completed: doc.get("completed") as MonitoringCounts | undefined, workKey: doc.ref.path };
    });
    return { seed: page.get("seed") as MonitoringPageSeed, items };
  };

  return {
    load,
    async save(seed: MonitoringPageSeed, sources: NormalizedAlert[], items: MonitoringProductWork[]): Promise<MonitoringPreparedPage> {
      const generation = randomUUID();
      const pageRef = runRef.collection("monitoring_work_pages").doc(generation);
      const expireAt = Timestamp.fromMillis(Date.now() + 7 * 24 * 60 * 60_000);
      const rows: Array<{ ref: DocumentReference; data: Record<string, unknown> }> = sources.map(source => ({
        ref: pageRef.collection("monitoring_work_sources").doc(source.id),
        data: { json: encode(source), expireAt },
      }));
      for (const item of items) {
        const productFields = ["shop", "productId", "productTitle", "productHandle", "name", "category", "description", "imageUrl", "imageUrls", "brand", "model", "barcodes", "sourceUpdatedAt"];
        const data = Object.fromEntries(productFields.filter(key => item.product.data[key] !== undefined).map(key => [key, item.product.data[key]]));
        const alerts = [...item.alerts.values()].map(alert => ({
          id: alert.id,
          fields: { pictures: alert.fields.pictures, product_image: alert.fields.product_image, product_other_images: alert.fields.product_other_images },
        }));
        rows.push({ ref: pageRef.collection("monitoring_work_products").doc(item.product.id), data: {
          json: encode({ product: { id: item.product.id, data }, alerts }), expireAt,
        } });
      }
      await write(rows);
      // Publish only once all input documents exist. Interrupted preparations stay invisible.
      await write([
        { ref: pageRef, data: { seed, installation, sourceCount: sources.length, productCount: items.length, expireAt } },
        { ref: headRef, data: { generation, installation, expireAt } },
      ]);
      const saved = await load();
      if (!saved) throw new Error("Prepared monitoring page was not published");
      return saved;
    },
    async complete(item: MonitoringProductWork, completed: MonitoringCounts): Promise<void> {
      if (!item.workKey || !item.workKey.startsWith(runRef.path + "/monitoring_work_pages/")) throw new Error("Invalid monitoring work scope");
      await db.runTransaction(async transaction => {
        assertInstallation(await transaction.get(merchantRef));
        transaction.set(db.doc(item.workKey!), { completed, completedAt: FieldValue.serverTimestamp() }, { merge: true });
      });
      item.completed = completed;
    },
  };
}
