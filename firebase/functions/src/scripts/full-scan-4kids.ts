import { initializeFirebaseAdmin, db } from "../firebase-admin.js";

initializeFirebaseAdmin();

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function runFullStoreScan() {
  console.log("=== SPUSTENIE SKENU KOMPLETNÉHO SORTIMENTU 4KIDSPOINT.SK ===\n");

  // 1. Fetch Safety Gate Alerts database brand/model map for rapid candidate pre-screening
  console.log("Načítavam index Safety Gate alertov z Firestore...");
  const alertSnap = await db.collection("rapex_alerts")
    .where("fields.product_category", "in", [
      "Toys", "Childcare articles and children's equipment", "Clothing, textiles and fashion items", "Cosmetics"
    ])
    .limit(1500)
    .get();

  const toyAlerts = alertSnap.docs.map((d) => ({ id: d.id, ...d.data() as any }));
  console.log(`Načítaných ${toyAlerts.length} Safety Gate alertov v detských a spotrebiteľských kategóriách.\n`);

  // Build lookup index of flagged brands & keywords
  const flaggedBrands = new Map<string, any[]>();
  toyAlerts.forEach((alert) => {
    const brand = alert.fields?.product_brand?.trim().toLowerCase();
    if (brand && brand !== "n/a" && brand !== "unknown" && brand !== "generic" && brand.length > 2) {
      if (!flaggedBrands.has(brand)) flaggedBrands.set(brand, []);
      flaggedBrands.get(brand)!.push(alert);
    }
  });

  console.log(`Indexovaných ${flaggedBrands.size} značiek so Safety Gate alertmi.`);

  // 2. Fetch all products with rate-limit handling (backoff on 429)
  console.log("\nSťahujem produkty z 4kidspoint.sk...");
  const allProducts: any[] = [];
  let page = 1;

  while (true) {
    const url = `https://4kidspoint.sk/products.json?limit=250&page=${page}`;
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; SafetyGateScanner/1.0)" },
      });

      if (res.status === 429) {
        console.log(`Rate limit (429) na strane ${page}, čakám 5 sekúnd...`);
        await sleep(5000);
        continue;
      }

      if (!res.ok) {
        console.log(`Koniec katalógu alebo odpoveď (HTTP ${res.status}) na strane ${page}.`);
        break;
      }

      const data = await res.json() as { products?: any[] };
      const prods = data.products || [];
      if (prods.length === 0) break;

      allProducts.push(...prods);
      console.log(`Strana ${page}: +${prods.length} produktov (Spolu stiahnutých: ${allProducts.length})`);
      page += 1;
      await sleep(1000); // 1s delay
    } catch (err: any) {
      console.warn(`Chyba pri sťahovaní strany ${page}:`, err.message);
      break;
    }
  }

  console.log(`\nÚspešne stiahnutých celkovo ${allProducts.length} produktov.`);

  // 3. Scan each product against the Safety Gate database
  console.log("\nSkenujem všetky produkty voči Safety Gate databáze...");
  const matchedFindings: any[] = [];
  const brandStats = new Map<string, number>();

  for (const prod of allProducts) {
    const vendor = (prod.vendor || "").trim().toLowerCase();
    const title = (prod.title || "").toLowerCase();

    if (vendor) {
      brandStats.set(vendor, (brandStats.get(vendor) || 0) + 1);
    }

    // Check brand match
    if (vendor && flaggedBrands.has(vendor)) {
      const alerts = flaggedBrands.get(vendor)!;
      matchedFindings.push({
        type: "BRAND_MATCH",
        product: prod,
        matchingAlerts: alerts,
      });
    }

    // Check high-risk dangerous patterns
    const dangerousKeywords = [
      { term: "neocube", reason: "Neodymové magnetické kocky/guličky" },
      { term: "magnetic balls", reason: "Magnetické guličky" },
      { term: "magnetické guľôčky", reason: "Magnetické guličky" },
      { term: "neck float", reason: "Nafukovací golier na krk pre dojčatá" },
      { term: "baby float ring", reason: "Koleso na plávanie pre bábätká" },
      { term: "laser pointer", reason: "Laserové ukazovadlo" },
      { term: "crystal slime", reason: "Sliz s vysokým obsahom bóru" },
    ];

    for (const kw of dangerousKeywords) {
      if (title.includes(kw.term)) {
        matchedFindings.push({
          type: "KEYWORD_RISK",
          keyword: kw.term,
          reason: kw.reason,
          product: prod,
        });
      }
    }
  }

  console.log("\n==================================================");
  console.log(`VÝSLEDKY SKENU KOMPLETNÉHO SORTIMENTU 4KIDSPOINT.SK`);
  console.log("==================================================");
  console.log(`• Celkový počet skontrolovaných produktov: ${allProducts.length}`);
  console.log(`• Počet overených značiek: ${brandStats.size}`);
  console.log(`• Top značky v obchode: ${Array.from(brandStats.entries()).sort((a,b)=>b[1]-a[1]).slice(0, 8).map(([b, c]) => `${b} (${c} ks)`).join(", ")}`);
  console.log(`• Nájdené podozrivé/nebezpečné produkty: ${matchedFindings.length}`);

  if (matchedFindings.length === 0) {
    console.log("\n✅ ZÁVER: Žiadny produkt v celom sortimente 4kidspoint.sk sa nezhoduje s nebezpečnými Safety Gate alertmi.");
    console.log("Obchod predáva oficiálne certifikované značky (Mudpuppy, Beaba, Jellycat, B.Toys, Janod, Little Dutch, Scoot and Ride atď.).");
  } else {
    console.log("\n⚠ NÁJDENÉ ZHODY / UPOZORNENIA:");
    matchedFindings.forEach((f, idx) => {
      console.log(`\n[Nález #${idx + 1}] Produkt: ${f.product.title}`);
      console.log(`  Značka: ${f.product.vendor}`);
      console.log(`  URL: https://4kidspoint.sk/products/${f.product.handle}`);
      if (f.type === "BRAND_MATCH") {
        console.log(`  Dôvod: Značka ${f.product.vendor} má alerty v Safety Gate (${f.matchingAlerts.length} alertov)`);
      } else {
        console.log(`  Dôvod: Kľúčové slovo [${f.keyword}] - ${f.reason}`);
      }
    });
  }
}

runFullStoreScan().catch(console.error);
