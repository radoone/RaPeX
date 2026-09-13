import { initializeFirebaseAdmin, db } from "../firebase-admin.js";
import { handleScanPublicShopifyStoreRequest } from "../public-store-scanner.js";

initializeFirebaseAdmin();

async function runTrigger() {
  const targetDomain = "4kidspoint.sk";
  console.log(`=== SPUSTENIE CLOUDOVÉHO SKENERU PRE ${targetDomain} ===\n`);

  const mockRequest: any = {
    method: "POST",
    headers: {},
    query: {},
    body: {
      domain: targetDomain,
      maxProducts: 100,
      similarityThreshold: 50,
    },
  };

  let responseData: any = null;
  let responseStatusCode = 200;

  const mockResponse: any = {
    set: () => mockResponse,
    status: (code: number) => {
      responseStatusCode = code;
      return mockResponse;
    },
    json: (payload: any) => {
      responseData = payload;
      console.log(`[Response HTTP ${responseStatusCode}]`);
    },
    send: (payload: string) => {
      console.log(`[Response send]:`, payload);
    },
  };

  await handleScanPublicShopifyStoreRequest(mockRequest, mockResponse);

  console.log("\n=== VÝSLEDOK CLOUDOVÉHO SKENU ===");
  if (responseData?.lead) {
    const lead = responseData.lead;
    console.log(`• Doména: ${lead.domain}`);
    console.log(`• Kontaktný e-mail: ${lead.contactEmail || 'Nenájdený'}`);
    console.log(`• Skontrolovaných produktov: ${lead.totalProductsScanned}`);
    console.log(`• Počet nájdených porušení (flagged): ${lead.flaggedProductsCount}`);
    console.log(`• Lead Priority Score: ${lead.leadScore} / 100 (${lead.priorityLevel})`);
    console.log(`• Zhrnutie: ${lead.summary}`);

    // Verify record in Firestore
    const docSnap = await db.collection("rapex_leads").doc(encodeURIComponent(targetDomain)).get();
    console.log(`\n• Stav uloženia v databáze Firestore (rapex_leads): ${docSnap.exists ? '✅ Uložené' : '❌ Neuložené'}`);
  } else {
    console.log("Odpoveď:", responseData);
  }
}

runTrigger().catch(console.error);
