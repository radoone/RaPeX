import { FieldPath, Timestamp } from "firebase-admin/firestore";
import { db } from "../firebase-admin.js";

const PAGE_SIZE = 400;
const BATCH_LIMIT = 450;
const RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

async function backfillPublicScanRetention(): Promise<void> {
  if (process.env.CONFIRM_PUBLIC_SCAN_RETENTION_BACKFILL !== "apply") {
    throw new Error("Set CONFIRM_PUBLIC_SCAN_RETENTION_BACKFILL=apply to run this one-time retention backfill");
  }
  const expiry = Timestamp.fromMillis(Date.now() + RETENTION_MS);
  const leads = await db.collection("rapex_leads").get();
  let batch = db.batch();
  let pendingWrites = 0;
  let productCount = 0;

  const commitIfNeeded = async (force = false): Promise<void> => {
    if (pendingWrites === 0 || (!force && pendingWrites < BATCH_LIMIT)) return;
    await batch.commit();
    batch = db.batch();
    pendingWrites = 0;
  };

  for (const lead of leads.docs) {
    batch.set(lead.ref, { expireAt: expiry }, { merge: true });
    pendingWrites += 1;

    const products = lead.ref.collection("products");
    let page = await products
      .select("productId")
      .orderBy(FieldPath.documentId())
      .limit(PAGE_SIZE)
      .get();

    while (!page.empty) {
      for (const product of page.docs) {
        batch.set(product.ref, { expireAt: expiry }, { merge: true });
        pendingWrites += 1;
        productCount += 1;
        if (pendingWrites >= BATCH_LIMIT) await commitIfNeeded(true);
      }

      if (page.size < PAGE_SIZE) break;
      const lastProduct = page.docs.at(-1);
      if (!lastProduct) break;
      page = await products
        .select("productId")
        .orderBy(FieldPath.documentId())
        .startAfter(lastProduct)
        .limit(PAGE_SIZE)
        .get();
    }
  }

  await commitIfNeeded(true);
  console.log(JSON.stringify({
    leadDocumentsUpdated: leads.size,
    productDocumentsUpdated: productCount,
    expiresAt: expiry.toDate().toISOString(),
  }));
}

backfillPublicScanRetention().catch((error: unknown) => {
  console.error("Public scan retention backfill failed", error);
  process.exitCode = 1;
});
