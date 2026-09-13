import { initializeFirebaseAdmin, db } from "../firebase-admin.js";
import { checkProductAgainstAlerts } from "../safety-gate-checker.js";
import type { ProductInput } from "../safety-gate-checker.schemas.js";
import { buildEmbeddingText, embedTexts } from "../safety-gate-embeddings.js";
import { retrieveAlertsForVector } from "../safety-gate-checker-retrieval.js";
import type { NormalizedAlert } from "../safety-gate-checker.types.js";

initializeFirebaseAdmin();

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchWithCooldown(url: string): Promise<{ ok: boolean; status: number; products: any[] }> {
  while (true) {
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
          "Accept": "application/json",
          "Accept-Language": "sk,cs;q=0.9,en;q=0.8",
        },
      });

      if (res.status === 429) {
        console.log("Shopify rate limit aktívny (429), čakám 15 sekúnd...");
        await sleep(15000);
        continue;
      }

      if (!res.ok) {
        return { ok: false, status: res.status, products: [] };
      }

      const data = await res.json() as { products?: any[] };
      return { ok: true, status: res.status, products: data.products || [] };
    } catch (err: any) {
      console.warn("Chyba spojenia, skúšam znova o 10s:", err.message);
      await sleep(10000);
    }
  }
}

function stripHtml(val: unknown): string {
  if (typeof val !== "string") return "";
  return val.replace(/<[^>]*>/g, "").trim();
}

function normalizeTags(tags: unknown): string[] {
  if (Array.isArray(tags)) return tags.filter((t): t is string => typeof t === "string");
  if (typeof tags === "string") return tags.split(",").map((t) => t.trim()).filter(Boolean);
  return [];
}

async function runFullLiveStoreScan() {
  const domain = "4kidspoint.sk";
  console.log("==================================================");
  console.log(`SKENOVANIE CELÉHO SORTIMENTU: ${domain}`);
  console.log("==================================================\n");

  const startTime = Date.now();

  // 1. Download all products from store catalogue
  console.log("1. Sťahujem produkty z verejného katalógu...");
  const allRawProducts: any[] = [];
  let page = 1;

  while (true) {
    const url = `https://${domain}/products.json?limit=250&page=${page}`;
    const res = await fetchWithCooldown(url);

    if (!res.ok || res.products.length === 0) {
      console.log(`Koniec katalógu dosiahnutý na strane ${page}.`);
      break;
    }

    allRawProducts.push(...res.products);
    console.log(`Strana ${page}: +${res.products.length} produktov (Celkovo: ${allRawProducts.length})`);
    page += 1;
    await sleep(2500);
  }

  console.log(`\n-> Stiahnutých ${allRawProducts.length} produktov za ${((Date.now() - startTime) / 1000).toFixed(1)}s.\n`);

  // 2. Prepare inputs and batch vectorize
  console.log("2. Spúšťam dávkovú vektorizáciu (Batch Text Embeddings)...");
  const productInputs: ProductInput[] = allRawProducts.map((raw) => {
    const tags = normalizeTags(raw.tags);
    const category = raw.product_type || tags.find((t) =>
      ['toys', 'childcare', 'clothing', 'cosmetics', 'baby'].includes(t.toLowerCase())
    ) || 'toys';

    const description = stripHtml(raw.body_html || raw.description || raw.title || "");
    const images = Array.isArray(raw.images) ? raw.images.map((img: any) => typeof img === "string" ? img : img?.src).filter(Boolean) : [];
    const brand = raw.vendor || tags.find((t) => t.toLowerCase().includes("brand:"))?.replace(/brand:\s*/i, "");

    return {
      name: String(raw.title || "Untitled"),
      category: category.toLowerCase(),
      description,
      imageUrl: images[0],
      imageUrls: images.slice(0, 4),
      brand,
      shop: domain,
      productId: String(raw.id || raw.handle),
    };
  });

  const embeddingTexts = productInputs.map((p) =>
    buildEmbeddingText({
      brand: p.brand,
      model: p.model,
      category: p.category,
      title: p.name,
      description: p.description,
    })
  );

  const embedStart = Date.now();
  const allVectors: Array<number[] | undefined> = [];
  const BATCH_SIZE = 100;
  for (let i = 0; i < embeddingTexts.length; i += BATCH_SIZE) {
    const chunk = embeddingTexts.slice(i, i + BATCH_SIZE);
    const vectors = await embedTexts(chunk);
    allVectors.push(...vectors);
    console.log(`   • Vygenerované embeddingy: ${allVectors.length} / ${embeddingTexts.length}`);
  }
  console.log(`-> Dávková vektorizácia dokončená za ${((Date.now() - embedStart) / 1000).toFixed(1)}s.\n`);

  // 3. Fast KNN Firestore Retrieval to find candidate alerts
  console.log("3. Vyhľadávam podozrivých kandidátov vo Firestore cez KNN Cosine Search...");
  const knnStart = Date.now();
  const candidatePairs: Array<{
    productInput: ProductInput;
    raw: any;
    candidateAlerts: NormalizedAlert[];
  }> = [];

  const KNN_CONCURRENCY = 16;
  for (let i = 0; i < productInputs.length; i += KNN_CONCURRENCY) {
    const chunk = productInputs.slice(i, i + KNN_CONCURRENCY);
    await Promise.all(
      chunk.map(async (pInput, idx) => {
        const globalIdx = i + idx;
        const vector = allVectors[globalIdx];
        if (!vector || vector.length === 0) return;

        const candidateAlerts = await retrieveAlertsForVector(vector, 6);

        if (candidateAlerts.length > 0) {
          candidatePairs.push({
            productInput: pInput,
            raw: allRawProducts[globalIdx],
            candidateAlerts,
          });
        }
      })
    );

    if ((i + KNN_CONCURRENCY) % 500 < KNN_CONCURRENCY || i + KNN_CONCURRENCY >= productInputs.length) {
      console.log(`   • KNN filter postup: ${Math.min(i + KNN_CONCURRENCY, productInputs.length)} / ${productInputs.length} produktov (Kandidátov na AI: ${candidatePairs.length})`);
    }
  }

  console.log(
    `\n-> KNN filter dokončený za ${((Date.now() - knnStart) / 1000).toFixed(1)}s: ${candidatePairs.length} z ${productInputs.length} produktov vyžaduje AI arbitráž.\n`
  );

  // 4. Targeted AI analysis (Gemini 2.5 Flash) ONLY on candidate pairs
  console.log("4. Spúšťam cielenú Gemini 2.5 Flash arbitráž len pre vyfiltrovaných kandidátov...");
  const aiStart = Date.now();
  const flaggedProducts: any[] = [];
  const similarityThreshold = 70;
  const LLM_CONCURRENCY = 4;
  let aiProcessed = 0;

  for (let i = 0; i < candidatePairs.length; i += LLM_CONCURRENCY) {
    const chunk = candidatePairs.slice(i, i + LLM_CONCURRENCY);
    await Promise.all(
      chunk.map(async (candidate) => {
        try {
          const checkResult = await checkProductAgainstAlerts(
            candidate.productInput,
            candidate.candidateAlerts
          );
          aiProcessed += 1;

          const significantWarnings = checkResult.warnings.filter(
            (w) => (w.overallSimilarity || 0) >= similarityThreshold
          );

          if (significantWarnings.length > 0) {
            flaggedProducts.push({
              product: candidate.raw,
              productInput: candidate.productInput,
              warnings: significantWarnings,
            });
            console.log(`\n⚠ [ZÁCHYT #${flaggedProducts.length}] ${candidate.raw.title}`);
            significantWarnings.forEach((w) => {
              console.log(`   • Alert ID: ${w.alertId} | Podobnosť: ${w.overallSimilarity}% | Riziko: ${w.riskLevel || 'N/A'}`);
              console.log(`   • Dôvod: ${w.reason}`);
            });
          }

          if (aiProcessed % 25 === 0 || aiProcessed === candidatePairs.length) {
            console.log(`   • AI arbitráž postup: ${aiProcessed} / ${candidatePairs.length} kandidátov (Záchytov: ${flaggedProducts.length})`);
          }
        } catch (err: any) {
          console.warn(`Chyba pri AI arbitráži ${candidate.raw.title}:`, err.message);
        }
      })
    );
  }

  console.log(`\n-> AI arbitráž dokončená za ${((Date.now() - aiStart) / 1000).toFixed(1)}s.\n`);

  const durationSec = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log("==================================================");
  console.log("KOMPLETNÝ VÝSLEDNÝ REPORT PRE: 4KIDSPOINT.SK");
  console.log("==================================================");
  console.log(`• Celkový čas behu: ${durationSec} s`);
  console.log(`• Počet skontrolovaných produktov: ${allRawProducts.length}`);
  console.log(`• Počet produktov vyžadujúcich AI kontrolu: ${candidatePairs.length}`);
  console.log(`• Počet potvrdených rizikových zhôd v Safety Gate: ${flaggedProducts.length}`);

  // 5. Save Lead in Firestore
  const leadDoc = {
    domain,
    storeUrl: `https://${domain}`,
    status: flaggedProducts.length > 0 ? "review_needed" : "new",
    leadScore: flaggedProducts.length > 0 ? Math.min(100, flaggedProducts.length * 20 + 30) : 0,
    priorityLevel: flaggedProducts.length > 0 ? "HIGH" : "SAFE",
    totalProductsScanned: allRawProducts.length,
    flaggedProductsCount: flaggedProducts.length,
    matches: flaggedProducts.map((f) => ({
      productId: String(f.product.id),
      productTitle: f.product.title,
      productUrl: `https://${domain}/products/${f.product.handle}`,
      productImage: f.productInput.imageUrl,
      vendor: f.productInput.brand,
      productType: f.productInput.category,
      result: {
        isSafe: false,
        warnings: f.warnings,
      },
    })),
    contactEmail: "info@4kidspoint.sk",
    scannedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  await db.collection("rapex_leads").doc(encodeURIComponent(domain)).set(leadDoc, { merge: true });
  console.log(`• Stav uloženia leadu v databáze (rapex_leads): ✅ Uložené\n`);
}

runFullLiveStoreScan().catch(console.error);

