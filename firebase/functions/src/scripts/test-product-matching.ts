import { initializeFirebaseAdmin, db } from "../firebase-admin.js";
import { retrieveAlertsWithRag } from "../safety-gate-checker-retrieval.js";
import { checkProductAgainstAlerts } from "../safety-gate-checker.js";
import type { ProductInput } from "../safety-gate-checker.schemas.js";

initializeFirebaseAdmin();

async function runTest() {
  console.log("=== TESTOVANIE VYHĽADÁVANIA A ZHODY V SAFETY GATE (RAPEX) ===\n");

  // 1. Check total count of alerts in Firestore
  const alertsCountSnap = await db.collection("rapex_alerts").count().get();
  console.log(`Celkový počet Safety Gate alertov v databáze: ${alertsCountSnap.data().count}\n`);

  // 2. Test Product 1: From 4kidspoint.sk (Baby shopping cart toy)
  const product1: ProductInput = {
    name: "OUT Hra na obchod Hudobný nákupný vozík s košíkom a príslušenstvom",
    category: "toys",
    description: "Hudobný nákupný vozík B.Toys s košíkom a príslušenstvom spája obľúbenú hru na hrdinov s veselými melódiami a farebnými doplnkami. Bezpečné materiály z odolného plastu bez obsahu BPA a ftalátov.",
    brand: "B.Toys",
    imageUrl: "https://cdn.shopify.com/s/files/1/0662/1711/5865/files/mybtoys_1624295730807307.jpg",
  };

  console.log("--- 1. Testovaný produkt z 4kidspoint.sk ---");
  console.log(`Názov: ${product1.name}`);
  console.log(`Značka: ${product1.brand}, Kategória: ${product1.category}`);

  console.log("\n-> Vyhľadávanie kandidátskych alertov cez RAG (vektorové vyhľadávanie v databáze)...");
  const candidates1 = await retrieveAlertsWithRag(product1);
  console.log(`Nájdených ${candidates1.length} relevantných alertov v okruhu podobnosti:`);
  candidates1.slice(0, 3).forEach((c, i) => {
    console.log(`  [${i + 1}] Alert ID: ${c.id} | Vzdialenosť: ${c.distance?.toFixed(3) ?? 'N/A'} | Značka: ${c.fields.product_brand || 'N/A'} | Kategória: ${c.fields.product_category}`);
    console.log(`      Popis: ${c.fields.product_description.slice(0, 100)}...`);
  });

  console.log("\n-> Spustenie porovnania cez Gemini matcher...");
  const result1 = await checkProductAgainstAlerts(product1, candidates1);
  console.log("Výsledok kontroly:");
  console.log(`  • Je bezpečný (isSafe): ${result1.isSafe}`);
  console.log(`  • Počet varovaní: ${result1.warnings.length}`);
  console.log(`  • Odporúčanie: ${result1.recommendation}`);
  if (result1.warnings.length > 0) {
    result1.warnings.forEach((w) => {
      console.log(`    ⚠ Zhoda (${w.overallSimilarity}%): Alert ${w.alertId} - Riziko: ${w.riskLevel} (${w.reason})`);
    });
  }

  // 3. Test Product 2: Known recalled toy (Slime / Magnetic balls / Laser pointer)
  const product2: ProductInput = {
    name: "Magnetic sculpture balls building blocks set 216 pcs",
    category: "toys",
    description: "Magnetic puzzle spheres 5mm neo cubes high power rare earth neodymium magnets educational toy for kids.",
    brand: "Generic",
    imageUrl: "https://m.media-amazon.com/images/I/61y8B3x7qTL._AC_SL1000_.jpg",
  };

  console.log("\n\n--- 2. Testovaný rizikový produkt (Neodymové magnetické guličky) ---");
  console.log(`Názov: ${product2.name}`);
  console.log(`Kategória: ${product2.category}`);

  console.log("\n-> Vyhľadávanie kandidátskych alertov cez RAG...");
  const candidates2 = await retrieveAlertsWithRag(product2);
  console.log(`Nájdených ${candidates2.length} relevantných alertov:`);
  candidates2.slice(0, 3).forEach((c, i) => {
    console.log(`  [${i + 1}] Alert ID: ${c.id} | Vzdialenosť: ${c.distance?.toFixed(3) ?? 'N/A'} | Značka: ${c.fields.product_brand || 'N/A'}`);
    console.log(`      Riziko: ${c.fields.risk_level || c.fields.alert_level} | ${c.fields.risk_legal_provision || ''}`);
  });

  console.log("\n-> Spustenie porovnania cez Gemini matcher...");
  const result2 = await checkProductAgainstAlerts(product2, candidates2);
  console.log("Výsledok kontroly:");
  console.log(`  • Je bezpečný (isSafe): ${result2.isSafe}`);
  console.log(`  • Počet varovaní: ${result2.warnings.length}`);
  console.log(`  • Odporúčanie: ${result2.recommendation}`);
  if (result2.warnings.length > 0) {
    result2.warnings.forEach((w) => {
      console.log(`    ⚠ Nájdená zhoda (${w.overallSimilarity}%): Alert ${w.alertId} - Úroveň rizika: ${w.riskLevel}`);
      console.log(`      Dôvod zhody: ${w.reason}`);
    });
  }
}

runTest().catch((err) => {
  console.error("Test matching error:", err);
});
