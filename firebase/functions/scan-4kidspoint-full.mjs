import { FieldValue } from "firebase-admin/firestore";
import { db } from "./lib/firebase-admin.js";
import { checkProductAgainstAlerts } from "./lib/safety-gate-checker.js";
import { retrieveAlertsForVector } from "./lib/safety-gate-checker-retrieval.js";
import { buildEmbeddingText, embedTexts } from "./lib/safety-gate-embeddings.js";
import { execSync } from "node:child_process";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function stripHtml(val) {
  if (!val || typeof val !== "string") return "";
  return val.replace(/<[^>]*>/g, "").trim();
}

function asVectorArray(value) {
  if (!value || typeof value !== "object") return undefined;
  if (typeof value.toArray === "function") return value.toArray();
  if (Array.isArray(value._values)) return value._values;
  return undefined;
}

async function fetchFullStoreCatalog(domain, maxProducts = 12000) {
  const products = [];
  let page = 1;
  const perPage = 250;

  while (products.length < maxProducts) {
    const fetchUrl = `https://${domain}/products.json?limit=${perPage}&page=${page}`;
    let pageProds = [];
    let success = false;

    for (let attempt = 1; attempt <= 8; attempt++) {
      try {
        const curlOut = execSync(
          `curl -s -H "User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36" -H "Accept: application/json" "${fetchUrl}"`,
          { maxBuffer: 30 * 1024 * 1024 }
        ).toString();

        if (curlOut.trim().startsWith("{")) {
          const data = JSON.parse(curlOut);
          pageProds = data.products || [];
          success = true;
          break;
        } else {
          console.log(`Page ${page} attempt ${attempt} returned 429/HTML. Waiting ${attempt * 5}s...`);
          await sleep(attempt * 5000);
        }
      } catch (e) {
        console.log(`Page ${page} attempt ${attempt} error: ${e.message}. Waiting ${attempt * 5}s...`);
        await sleep(attempt * 5000);
      }
    }

    if (!success || pageProds.length === 0) {
      console.log(`Catalog completed on page ${page}. Total downloaded: ${products.length}`);
      break;
    }

    products.push(...pageProds);
    console.log(`Page ${page}: +${pageProds.length} products (Total: ${products.length})`);
    if (pageProds.length < perPage || products.length >= maxProducts) break;

    page++;
    await sleep(400);
  }

  return products.slice(0, maxProducts);
}

async function run10kScan() {
  const domain = "4kidspoint.sk";
  const similarityThreshold = 80;
  console.log("==================================================");
  console.log("STARTING FULL 10K CATALOG SCAN FOR: " + domain);
  console.log("==================================================");

  const rawProducts = await fetchFullStoreCatalog(domain, 12000);
  console.log(`Successfully fetched ${rawProducts.length} total products from ${domain}`);

  const productInputs = rawProducts.map((raw) => {
    const tags = Array.isArray(raw?.tags) ? raw.tags : typeof raw?.tags === "string" ? raw.tags.split(",") : [];
    const category = raw.product_type || raw.productType || tags.find((t) =>
      ["toys", "electronics", "clothing", "cosmetics", "food", "jewelry"].includes(String(t).toLowerCase())
    ) || "general";

    const description = stripHtml(raw.body_html || raw.description || raw.title || "");
    const images = Array.isArray(raw.images) ? raw.images.map((img) => typeof img === "string" ? img : img?.src).filter(Boolean) : [];
    const brand = raw.vendor || "";

    return {
      name: String(raw.title || "Untitled product"),
      category: String(category).toLowerCase(),
      description,
      imageUrl: images[0],
      imageUrls: images.slice(0, 4),
      brand,
      shop: domain,
      productId: String(raw.id || raw.handle || ""),
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

  console.log(`Checking Firestore cache for ${productInputs.length} products...`);
  const productsCol = db.collection("rapex_leads").doc(domain).collection("products");
  const allVectors = new Array(productInputs.length);
  const toEmbedIndices = [];
  const toEmbedTexts = [];

  const CHUNK_SIZE = 100;
  for (let i = 0; i < productInputs.length; i += CHUNK_SIZE) {
    const chunkIds = productInputs.slice(i, i + CHUNK_SIZE).map((p) => p.productId).filter(Boolean);
    const docRefs = chunkIds.map((id) => productsCol.doc(encodeURIComponent(id)));
    try {
      const snapshots = await db.getAll(...docRefs);
      for (let j = 0; j < snapshots.length; j++) {
        const snap = snapshots[j];
        const globalIdx = i + j;
        if (snap.exists) {
          const data = snap.data();
          const vec = asVectorArray(data?.vector_text);
          if (vec && vec.length > 0) {
            allVectors[globalIdx] = vec;
            continue;
          }
        }
        toEmbedIndices.push(globalIdx);
        toEmbedTexts.push(embeddingTexts[globalIdx]);
      }
    } catch (e) {
      console.warn("Cache error at " + i + ":", e.message);
    }
  }

  const cachedCount = productInputs.length - toEmbedIndices.length;
  console.log(`Cache status: ${cachedCount} loaded from Firestore, ${toEmbedIndices.length} new items to embed.`);

  if (toEmbedTexts.length > 0) {
    const newlyEmbeddedToSave = [];
    const EMBED_BATCH_SIZE = 50;
    const PARALLEL_BATCHES = 5;

    for (let i = 0; i < toEmbedTexts.length; i += EMBED_BATCH_SIZE * PARALLEL_BATCHES) {
      const batchSliceTexts = [];
      const batchSliceIndices = [];

      for (let b = 0; b < PARALLEL_BATCHES; b++) {
        const start = i + b * EMBED_BATCH_SIZE;
        if (start >= toEmbedTexts.length) break;
        const end = Math.min(start + EMBED_BATCH_SIZE, toEmbedTexts.length);
        batchSliceTexts.push(toEmbedTexts.slice(start, end));
        batchSliceIndices.push(toEmbedIndices.slice(start, end));
      }

      const results = await Promise.all(batchSliceTexts.map((chunk) => embedTexts(chunk)));

      for (let b = 0; b < results.length; b++) {
        const vectors = results[b];
        const textChunk = batchSliceTexts[b];
        const indexChunk = batchSliceIndices[b];

        for (let j = 0; j < vectors.length; j++) {
          const globalProdIdx = indexChunk[j];
          const vec = vectors[j];
          allVectors[globalProdIdx] = vec;

          if (vec && vec.length > 0) {
            newlyEmbeddedToSave.push({
              productId: productInputs[globalProdIdx].productId || String(rawProducts[globalProdIdx]?.id || globalProdIdx),
              handle: rawProducts[globalProdIdx]?.handle,
              title: productInputs[globalProdIdx].name,
              pInput: productInputs[globalProdIdx],
              embeddingText: textChunk[j],
              vector: vec,
              sourceUpdatedAt: rawProducts[globalProdIdx]?.updated_at,
            });
          }
        }
      }
      process.stdout.write(`\rEmbedding Progress: ${Math.min(i + EMBED_BATCH_SIZE * PARALLEL_BATCHES, toEmbedTexts.length)} / ${toEmbedTexts.length}`);
    }
    console.log("\nEmbedding complete.");

    for (let i = 0; i < newlyEmbeddedToSave.length; i += 200) {
      const batch = db.batch();
      const chunk = newlyEmbeddedToSave.slice(i, i + 200);
      for (const item of chunk) {
        const docRef = productsCol.doc(encodeURIComponent(item.productId));
        batch.set(docRef, {
          productId: item.productId,
          handle: item.handle || "",
          title: item.title,
          brand: item.pInput.brand || null,
          category: item.pInput.category || null,
          description: item.pInput.description || null,
          imageUrl: item.pInput.imageUrl || null,
          imageUrls: item.pInput.imageUrls || [],
          embeddingText: item.embeddingText,
          vector_text: FieldValue.vector(item.vector),
          sourceUpdatedAt: item.sourceUpdatedAt || null,
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
      }
      await batch.commit();
    }
    console.log(`Saved ${newlyEmbeddedToSave.length} new product vectors to Firestore.`);
  }

  console.log(`Running fast Firestore vector KNN retrieval across all ${productInputs.length} products...`);
  const candidatePairs = [];
  const KNN_CONCURRENCY = 25;

  for (let i = 0; i < productInputs.length; i += KNN_CONCURRENCY) {
    const chunk = productInputs.slice(i, i + KNN_CONCURRENCY);
    await Promise.all(
      chunk.map(async (pInput, idx) => {
        const globalIdx = i + idx;
        const vector = allVectors[globalIdx];
        if (!vector || vector.length === 0) return;

        const candidateAlerts = await retrieveAlertsForVector(vector, 5);
        if (candidateAlerts.length > 0) {
          candidatePairs.push({
            productInput: pInput,
            raw: rawProducts[globalIdx],
            candidateAlerts,
          });
        }
      })
    );
    process.stdout.write(`\rKNN Progress: ${Math.min(i + KNN_CONCURRENCY, productInputs.length)} / ${productInputs.length} (Candidates: ${candidatePairs.length})`);
  }
  console.log(`\nFound ${candidatePairs.length} candidate products requiring AI analysis.`);

  const matches = [];
  const LLM_CONCURRENCY = 3;

  for (let i = 0; i < candidatePairs.length; i += LLM_CONCURRENCY) {
    const chunk = candidatePairs.slice(i, i + LLM_CONCURRENCY);
    await Promise.all(
      chunk.map(async (candidate) => {
        try {
          const checkResult = await checkProductAgainstAlerts(
            candidate.productInput,
            candidate.candidateAlerts
          );

          const filteredWarnings = checkResult.warnings.filter(
            (w) => (w.overallSimilarity || 0) >= similarityThreshold
          );

          if (filteredWarnings.length > 0) {
            console.log(`\n🚨 MATCH (${filteredWarnings[0].overallSimilarity}%): ${candidate.raw.title}`);
            matches.push({
              productId: candidate.raw.id ? String(candidate.raw.id) : candidate.productInput.productId,
              productTitle: candidate.raw.title,
              productUrl: candidate.raw.handle ? `https://${domain}/products/${candidate.raw.handle}` : `https://${domain}/search?q=${encodeURIComponent(candidate.raw.title || "")}`,
              productImage: candidate.productInput.imageUrl,
              vendor: candidate.productInput.brand,
              productType: candidate.productInput.category,
              result: {
                ...checkResult,
                warnings: filteredWarnings,
                isSafe: false,
              },
            });
          }
        } catch (e) {
          console.warn("AI error:", e.message);
        }
      })
    );
    process.stdout.write(`\rAI Progress: ${Math.min(i + LLM_CONCURRENCY, candidatePairs.length)} / ${candidatePairs.length} (Matches: ${matches.length})`);
  }

  const leadRef = db.collection("rapex_leads").doc(domain);
  const now = new Date().toISOString();

  await leadRef.set({
    domain,
    storeUrl: `https://${domain}`,
    status: matches.length > 0 ? "review_needed" : "new",
    leadScore: Math.min(100, 30 + matches.length * 8),
    priorityLevel: matches.length > 0 ? "HIGH" : "SAFE",
    totalProductsScanned: rawProducts.length,
    flaggedProductsCount: matches.length,
    matches,
    contactEmail: "info@4kidspoint.sk",
    scannedAt: now,
    updatedAt: now,
    scanProgress: {
      stage: "completed",
      percent: 100,
      message: `Sken dokončený. Preverených všetkých ${rawProducts.length} produktov, zistených ${matches.length} záchytov.`,
    },
  }, { merge: true });

  console.log(`\n==================================================`);
  console.log(`FULL SCAN COMPLETED: ${rawProducts.length} PRODUCTS SCANNED, ${matches.length} MATCHES FOUND.`);
  console.log(`==================================================`);
}

run10kScan().catch(console.error);
