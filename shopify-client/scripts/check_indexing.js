import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const projectId = process.env.FIREBASE_PROJECT_ID || "rapex-99a2c";

initializeApp({
  credential: applicationDefault(),
  projectId,
});

const db = getFirestore();

async function run() {
  try {
    const snap = await db.collection("rapex_alerts")
      .orderBy("meta.alert_date", "desc")
      .orderBy("meta.record_timestamp", "desc")
      .limit(1)
      .get();
      
    if (snap.empty) {
      console.log("No alerts found.");
      return;
    }
    
    const doc = snap.docs[0];
    const data = doc.data();
    console.log("NEWEST_RECORD_DETAILS:", JSON.stringify({
      id: doc.id,
      alert_date: data.meta?.alert_date?.toDate().toISOString(),
      record_timestamp: data.meta?.record_timestamp,
      brand: data.fields?.product_brand || "N/A",
      model: data.fields?.product_model || "N/A",
      type: data.fields?.product_type || "N/A",
      category: data.fields?.product_category || "N/A",
      danger: data.fields?.technical_defect || "N/A",
      ingested_at: data.meta?.ingested_at?.toDate().toISOString(),
    }, null, 2));
    
  } catch (error) {
    console.error("Error fetching newest record:", error);
  }
}

run();
