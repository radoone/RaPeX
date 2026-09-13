import { initializeFirebaseAdmin, db } from "../firebase-admin.js";
import { handleScanPublicShopifyStoreRequest } from "../public-store-scanner.js";

initializeFirebaseAdmin();

async function runGenericStoreScan() {
  const rawDomain = process.argv[2];
  if (!rawDomain) {
    console.log("Použitie:");
    console.log("  npm run scan -- <domena-obchodu.sk> [pocetProduktov] [prahZhody]");
    console.log("Príklad:");
    console.log("  npm run scan -- gymbeam.sk 250 60\n");
  }

  const targetDomain = (rawDomain || "4kidspoint.sk")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "");

  const maxProducts = parseInt(process.argv[3] || "250", 10);
  const similarityThreshold = parseInt(process.argv[4] || "60", 10);

  console.log(`\n======================================================`);
  console.log(`🔍 SPUSTENIE RAPEX / SAFETY GATE AUDITU OBCHODU`);
  console.log(`• Doména:               ${targetDomain}`);
  console.log(`• Max produktov:        ${maxProducts}`);
  console.log(`• Prah zhody (AI filter): >= ${similarityThreshold}%`);
  console.log(`======================================================\n`);

  const mockRequest: any = {
    method: "POST",
    headers: {},
    query: {},
    body: {
      domain: targetDomain,
      maxProducts,
      similarityThreshold,
    },
  };

  let responseData: any = null;

  const mockResponse: any = {
    set: () => mockResponse,
    status: () => mockResponse,
    json: (payload: any) => {
      responseData = payload;
    },
    send: (payload: string) => {
      console.log(`[Response send]:`, payload);
    },
  };

  const startTime = Date.now();
  await handleScanPublicShopifyStoreRequest(mockRequest, mockResponse);
  const durationSec = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log("\n======================================================");
  console.log(`📊 VÝSLEDOK AUDITU (${durationSec}s)`);
  console.log("======================================================");

  if (responseData?.lead) {
    const lead = responseData.lead;
    console.log(`• Doména:                 ${lead.domain}`);
    console.log(`• Kontaktný e-mail:       ${lead.contactEmail || 'Nenájdený na webe'}`);
    console.log(`• Skontrolované produkty: ${lead.totalProductsScanned}`);
    console.log(`• Počet záchytov RAPEX:   ${lead.flaggedProductsCount}`);
    console.log(`• Závažné riziká (EÚ):    ${lead.seriousRiskCount}`);
    console.log(`• Najvyššia zhoda:        ${lead.highestSimilarity}%`);
    console.log(`• Lead Priority Score:    ${lead.leadScore} / 100 (${lead.priorityLevel})`);
    console.log(`• Zhrnutie:               ${lead.summary}`);

    if (lead.matches?.length > 0) {
      console.log(`\n📋 Nájdené rizikové produkty v obchode (prvých 10):`);
      lead.matches.slice(0, 10).forEach((m: any, idx: number) => {
        const w = m.result?.warnings?.[0] || {};
        console.log(`  ${idx + 1}. [${w.overallSimilarity || 0}% zhoda | ${w.riskLevel || 'Riziko'}] ${m.productTitle}`);
        console.log(`     URL:   ${m.productUrl || `https://${targetDomain}/products/${m.productId}`}`);
        console.log(`     RAPEX: ${w.message || w.reason || w.riskLegalProvision || 'Porušenie smernice EÚ'}`);
      });
      if (lead.matches.length > 10) {
        console.log(`  ... a ďalších ${lead.matches.length - 10} produktov.`);
      }
    }

    const docSnap = await db.collection("rapex_leads").doc(encodeURIComponent(targetDomain)).get();
    console.log(`\n• Stav vo Firestore (rapex_leads/${targetDomain}): ${docSnap.exists ? '✅ Uložené' : '❌ Neuložené'}`);
  } else {
    console.error("Chyba:", responseData);
  }
}

runGenericStoreScan().catch(console.error);
