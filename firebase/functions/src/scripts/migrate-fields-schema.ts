import type { DocumentSnapshot } from "firebase-admin/firestore";
import { db } from "../firebase-admin.js";
import { FIRESTORE_COLLECTIONS } from "../safety-gate-config.js";

async function runMigration() {
  console.log("=== Starting Schema Migration to Official ec.europa.eu Fields ===");
  const collectionRef = db.collection(FIRESTORE_COLLECTIONS.alerts);
  const bulkWriter = db.bulkWriter();
  bulkWriter.onWriteError((error) => {
    console.error(`Write failed for document ${error.documentRef.id}:`, error.message);
    return error.failedAttempts < 3;
  });

  const PAGE_SIZE = 1000;
  let lastDoc: DocumentSnapshot | null = null;
  let totalProcessed = 0;
  let totalUpdated = 0;

  while (true) {
    let query = collectionRef
      .select("fields")
      .orderBy("__name__")
      .limit(PAGE_SIZE);

    if (lastDoc) {
      query = query.startAfter(lastDoc);
    }

    const snapshot = await query.get();
    if (snapshot.empty) {
      break;
    }

    for (const doc of snapshot.docs) {
      totalProcessed++;
      const f = (doc.data().fields || {}) as Record<string, any>;

      // Check if official ec.europa.eu fields are already populated
      if (f.caseNumber && f.brand !== undefined && f.danger !== undefined && f.level !== undefined) {
        continue;
      }

      const caseNumber = f.caseNumber || f.alert_number || "";
      const brand = f.brand || f.product_brand || "";
      const name = f.name || f.product_name || "";
      const product = f.product || f.product_type || "";
      const type_numberOfModel = f.type_numberOfModel || f.product_model_type || f.product_model || "";
      const category = f.category || f.product_category || "";
      const batchNumber = f.batchNumber || f.batch_number || f.product_batch_number || "";
      const barcode = f.barcode || f.product_barcode || "";
      const riskType = f.riskType || f.risk_type || f.alert_type || "";
      const danger = f.danger || f.alert_description || f.technical_defect || "";
      const measures = f.measures || f.measures_country || f.technical_defect || "";
      const description = f.description || f.product_description || "";
      const notifyingCountry = f.notifyingCountry || f.alert_country || f.notifying_country || "";
      const countryOfOrigin = f.countryOfOrigin || f.product_country || f.country_of_origin || "";
      const level = f.level || f.alert_level || f.risk_level || "";
      const url = f.url || f.rapex_url || "";

      let pictures: string[] = Array.isArray(f.pictures) && f.pictures.length > 0 ? f.pictures : [];
      if (pictures.length === 0) {
        if (f.product_image) pictures.push(f.product_image);
        if (typeof f.product_other_images === "string" && f.product_other_images) {
          pictures.push(...f.product_other_images.split(",").map((s: string) => s.trim()).filter(Boolean));
        }
      }

      const updatedFields: Record<string, any> = {
        ...f,
        caseNumber,
        brand,
        name,
        product,
        type_numberOfModel,
        category,
        batchNumber,
        barcode,
        riskType,
        danger,
        measures,
        description,
        notifyingCountry,
        countryOfOrigin,
        level,
        pictures,
        url,
      };

      bulkWriter.update(doc.ref, { fields: updatedFields });
      totalUpdated++;
    }

    lastDoc = snapshot.docs[snapshot.docs.length - 1];
    console.log(`Processed: ${totalProcessed} documents, queued updates: ${totalUpdated}...`);
  }

  console.log(`Flushing writes to Firestore...`);
  await bulkWriter.close();
  console.log(`=== Migration Finished! Total processed: ${totalProcessed}, Total updated: ${totalUpdated} ===`);
}

runMigration().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
