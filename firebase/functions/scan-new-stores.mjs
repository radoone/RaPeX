import { FieldValue } from "firebase-admin/firestore";
import { db } from "./lib/firebase-admin.js";
import { checkProductAgainstAlerts } from "./lib/safety-gate-checker.js";
import { retrieveAlertsForVector } from "./lib/safety-gate-checker-retrieval.js";
import { buildEmbeddingText, embedTexts } from "./lib/safety-gate-embeddings.js";

const COMMON_CONTACT_PATHS = [
  "/pages/contact",
  "/pages/contact-us",
  "/pages/kontakt",
  "/pages/impressum",
  "/policies/terms-of-service",
  "/policies/privacy-policy",
  "",
];

const EMAIL_REGEX = /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/g;
const MAILTO_REGEX = /mailto:([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/gi;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function extractContactEmail(domain) {
  const baseUrl = `https://${domain}`;
  const candidates = new Set();

  for (const path of COMMON_CONTACT_PATHS) {
    try {
      const res = await fetch(`${baseUrl}${path}`, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
      });

      if (!res.ok) continue;
      const html = await res.text();

      let match;
      while ((match = MAILTO_REGEX.exec(html)) !== null) {
        const email = match[1].toLowerCase().trim();
        if (!email.includes("sentry") && !email.includes("shopify") && !email.includes(".png")) {
          candidates.add(email);
        }
      }

      const regexMatches = html.match(EMAIL_REGEX) || [];
      for (const raw of regexMatches) {
        const email = raw.toLowerCase().trim();
        if (!email.includes("sentry") && !email.includes("shopify") && !email.includes(".png") && !email.startsWith("user@")) {
          candidates.add(email);
        }
      }

      const cleanDomain = domain.replace(/^www\./, "");
      const matchingDomainEmail = Array.from(candidates).find((e) => e.includes(cleanDomain));
      if (matchingDomainEmail) return matchingDomainEmail;
    } catch (err) {
      void err;
    }
  }

  const all = Array.from(candidates);
  const cleanDomain = domain.replace(/^www\./, "");
  return all.find((e) => e.includes(cleanDomain)) || all[0] || null;
}

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

import { execSync } from "node:child_process";

async function fetchStoreCatalog(domain, maxProducts = 3000) {
  const products = [];
  let page = 1;
  const perPage = 250;

  while (products.length < maxProducts) {
    const fetchUrl = `https://${domain}/products.json?limit=${perPage}&page=${page}`;
    let pageProds = [];

    try {
      const res = await fetch(fetchUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
          "Accept": "application/json",
          "Accept-Language": "sk,cs;q=0.9,en;q=0.8",
        },
      });

      if (res.ok) {
        const data = await res.json();
        pageProds = data.products || [];
      } else {
        // Fallback to curl
        const curlOut = execSync(
          `curl -s -H "User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36" -H "Accept: application/json" "${fetchUrl}"`,
          { maxBuffer: 20 * 1024 * 1024 }
        ).toString();
        const data = JSON.parse(curlOut);
        pageProds = data.products || [];
      }
    } catch (err) {
      try {
        const curlOut = execSync(
          `curl -s -H "User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36" -H "Accept: application/json" "${fetchUrl}"`,
          { maxBuffer: 20 * 1024 * 1024 }
        ).toString();
        const data = JSON.parse(curlOut);
        pageProds = data.products || [];
      } catch (curlErr) {
        console.warn(`Failed fetching page ${page} from ${domain}:`, curlErr.message);
        break;
      }
    }

    if (pageProds.length === 0) break;
    products.push(...pageProds);
    if (pageProds.length < perPage || products.length >= maxProducts) break;

    page += 1;
    await sleep(350);
  }

  return products.slice(0, maxProducts);
}

function shopifyRawToProductInput(raw, shop) {
  const tags = Array.isArray(raw?.tags) ? raw.tags : typeof raw?.tags === "string" ? raw.tags.split(",") : [];
  const category = raw.product_type || raw.productType || tags.find((t) =>
    ['toys', 'electronics', 'clothing', 'cosmetics', 'food', 'jewelry'].includes(String(t).toLowerCase())
  ) || 'general';

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
    shop,
    productId: String(raw.id || raw.handle || ""),
  };
}

async function loadCachedProductVectors(domain, productIds) {
  const result = new Map();
  if (!productIds.length) return result;

  const productsCol = db.collection("rapex_leads").doc(encodeURIComponent(domain)).collection("products");
  const CHUNK_SIZE = 100;

  for (let i = 0; i < productIds.length; i += CHUNK_SIZE) {
    const chunkIds = productIds.slice(i, i + CHUNK_SIZE);
    const docRefs = chunkIds.map((id) => productsCol.doc(encodeURIComponent(id)));
    try {
      const snapshots = await db.getAll(...docRefs);
      for (let j = 0; j < snapshots.length; j++) {
        const snap = snapshots[j];
        if (snap.exists) {
          const data = snap.data();
          const vector = asVectorArray(data?.vector_text);
          if (vector && vector.length > 0) {
            result.set(chunkIds[j], {
              vector,
              embeddingText: data?.embeddingText,
              sourceUpdatedAt: data?.sourceUpdatedAt,
            });
          }
        }
      }
    } catch (err) {
      console.warn(`Cache load error for ${domain}:`, err.message);
    }
  }

  return result;
}

async function saveProductVectors(domain, items) {
  if (!items.length) return;
  const productsCol = db.collection("rapex_leads").doc(encodeURIComponent(domain)).collection("products");
  const BATCH_SIZE = 200;

  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const chunk = items.slice(i, i + BATCH_SIZE);
    const batch = db.batch();

    for (const item of chunk) {
      const docRef = productsCol.doc(encodeURIComponent(item.productId));
      batch.set(
        docRef,
        {
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
        },
        { merge: true }
      );
    }

    try {
      await batch.commit();
    } catch (err) {
      console.warn(`Vector save error for ${domain}:`, err.message);
    }
  }
}

async function enrichLeadMatches(matches, leadDomain) {
  if (!matches || !matches.length) return [];
  const alertIds = [...new Set(matches.map((m) => m.result?.warnings?.[0]?.alertId).filter(Boolean))];
  if (!alertIds.length) return matches;

  const alertDocs = await Promise.all(
    alertIds.map((id) => db.collection("rapex_alerts").doc(id).get())
  );
  const alertMap = new Map();
  for (const doc of alertDocs) {
    if (doc.exists) {
      const data = doc.data() || {};
      const f = data.fields || {};
      const alertNumber = f.alert_number || undefined;
      const rapexUrl =
        f.rapex_url ||
        (alertNumber
          ? `https://ec.europa.eu/safety-gate-alerts/screen/search?keywords=${encodeURIComponent(alertNumber)}`
          : undefined);
      alertMap.set(doc.id, {
        alertId: doc.id,
        alertNumber,
        rapexUrl,
        alertImage: f.product_image || (Array.isArray(f.pictures) ? f.pictures[0] : undefined),
        brand: f.product_brand || undefined,
        model: f.product_model || undefined,
        name: f.product_name || f.product_type || undefined,
        category: f.product_category || undefined,
        riskLevel: f.risk_level || f.alert_level || "Serious risk",
        alertType: f.alert_type || undefined,
        description: f.product_description || undefined,
        riskDescription: f.alert_description || f.risk_legal_provision || undefined,
        notifyingCountry: f.notifying_country || undefined,
      });
    }
  }

  return matches.map((m) => {
    const w = m.result?.warnings?.[0];
    const alertMeta = w?.alertId ? alertMap.get(w.alertId) : undefined;
    const storeDomain = leadDomain || m.shop || "";
    let productUrl = m.productUrl;
    if (!productUrl || productUrl.includes("undefined") || productUrl.endsWith("/products/") || productUrl.endsWith("/products")) {
      productUrl = storeDomain ? `https://${storeDomain}/search?q=${encodeURIComponent(m.productTitle || "")}` : undefined;
    }
    return {
      ...m,
      productUrl,
      alertDetails: alertMeta,
    };
  });
}

function computeScore(totalProductsScanned, flaggedMatches) {
  const flaggedCount = flaggedMatches.length;
  if (flaggedCount === 0 || totalProductsScanned === 0) {
    return {
      leadScore: 0,
      priorityLevel: "SAFE",
      totalWarningsCount: 0,
      seriousRiskCount: 0,
      highestSimilarity: 0,
      summary: "No Safety Gate compliance violations detected in scanned catalogue.",
    };
  }

  let totalWarningsCount = 0;
  let seriousRiskCount = 0;
  let highestSimilarity = 0;

  for (const match of flaggedMatches) {
    for (const w of match.result.warnings) {
      totalWarningsCount += 1;
      const sim = Number.isFinite(w.overallSimilarity) ? w.overallSimilarity : 0;
      if (sim > highestSimilarity) highestSimilarity = sim;
      const risk = (w.riskLevel || "").toLowerCase();
      if (risk === "serious" || risk === "high") seriousRiskCount += 1;
    }
  }

  const seriousRiskWeight = Math.min(45, seriousRiskCount * 25);
  const similarityWeight = highestSimilarity >= 90 ? 30 : highestSimilarity >= 80 ? 20 : 10;
  const multiProductWeight = flaggedCount > 1 ? Math.min(15, (flaggedCount - 1) * 5 + 5) : 0;
  const rawScore = seriousRiskWeight + similarityWeight + multiProductWeight + 10;
  const leadScore = Math.min(100, Math.max(1, rawScore));
  const priorityLevel = leadScore >= 75 || seriousRiskCount > 0 ? "CRITICAL" : leadScore >= 50 ? "HIGH" : "MEDIUM";

  return {
    leadScore,
    priorityLevel,
    totalWarningsCount,
    seriousRiskCount,
    highestSimilarity,
    summary: `Found ${flaggedCount} product(s) matching Safety Gate alerts (${seriousRiskCount} serious violations, highest similarity ${highestSimilarity}%).`,
  };
}

async function scanStore(domain, similarityThreshold = 80) {
  console.log(`\n==================================================`);
  console.log(`STARTING SCAN FOR: ${domain}`);
  console.log(`==================================================`);

  const startTime = Date.now();

  // 1. Fetch catalog & contact
  const [rawProducts, contactEmail] = await Promise.all([
    fetchStoreCatalog(domain, 3000),
    extractContactEmail(domain),
  ]);

  console.log(`[${domain}] Fetched ${rawProducts.length} products. Contact: ${contactEmail || "N/A"}`);
  if (rawProducts.length === 0) {
    console.log(`[${domain}] No products found, skipping.`);
    return;
  }

  // 2. Prepare inputs
  const productInputs = rawProducts.map((raw) => shopifyRawToProductInput(raw, domain));
  const embeddingTexts = productInputs.map((p) =>
    buildEmbeddingText({
      brand: p.brand,
      model: p.model,
      category: p.category,
      title: p.name,
      description: p.description,
    })
  );

  // 3. Load or generate embeddings
  const cachedMap = await loadCachedProductVectors(
    domain,
    productInputs.map((p) => p.productId).filter(Boolean)
  );

  const allVectors = new Array(productInputs.length);
  const toEmbedIndices = [];
  const toEmbedTexts = [];

  for (let i = 0; i < productInputs.length; i++) {
    const p = productInputs[i];
    const text = embeddingTexts[i];
    const raw = rawProducts[i];
    const prodId = p.productId || String(raw?.id || raw?.handle || i);
    const cached = cachedMap.get(prodId);

    if (cached && (cached.embeddingText === text || (raw.updated_at && cached.sourceUpdatedAt === raw.updated_at))) {
      allVectors[i] = cached.vector;
    } else {
      toEmbedIndices.push(i);
      toEmbedTexts.push(text);
    }
  }

  console.log(`[${domain}] Embeddings: ${productInputs.length - toEmbedIndices.length} cached, ${toEmbedIndices.length} new to embed.`);

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
    }

    if (newlyEmbeddedToSave.length > 0) {
      await saveProductVectors(domain, newlyEmbeddedToSave);
      console.log(`[${domain}] Saved ${newlyEmbeddedToSave.length} product embeddings to Firestore.`);
    }
  }

  // 4. KNN Search against 32k alerts
  console.log(`[${domain}] Running fast Firestore vector KNN retrieval...`);
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
  }

  console.log(`[${domain}] Pre-filtering complete: ${candidatePairs.length} / ${productInputs.length} candidates require AI check.`);

  // 5. LLM check on candidates
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
            console.log(`\n🚨 [${domain}] MATCH DETECTED (${filteredWarnings[0].overallSimilarity}%): ${candidate.raw.title}`);
            console.log(`   Reason: ${filteredWarnings[0].reason}`);

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
        } catch (checkErr) {
          console.warn(`AI check failed for ${candidate.raw.title}:`, checkErr.message);
        }
      })
    );
  }

  // 6. Enrich matches and save Lead Doc
  const enrichedMatches = await enrichLeadMatches(matches, domain);
  const scoreResult = computeScore(rawProducts.length, enrichedMatches);
  const durationSec = ((Date.now() - startTime) / 1000).toFixed(1);
  const now = new Date().toISOString();

  const leadDoc = {
    domain,
    storeUrl: `https://${domain}`,
    status: matches.length > 0 ? "review_needed" : "new",
    leadScore: scoreResult.leadScore,
    priorityLevel: scoreResult.priorityLevel,
    totalProductsScanned: rawProducts.length,
    flaggedProductsCount: matches.length,
    totalWarningsCount: scoreResult.totalWarningsCount,
    seriousRiskCount: scoreResult.seriousRiskCount,
    highestSimilarity: scoreResult.highestSimilarity,
    summary: scoreResult.summary,
    matches: enrichedMatches,
    contactEmail: contactEmail || undefined,
    scannedAt: now,
    updatedAt: now,
    scanProgress: {
      stage: "completed",
      percent: 100,
      message: `Sken dokončený za ${durationSec}s. Preverených ${rawProducts.length} produktov, zistených ${matches.length} záchytov.`,
    },
  };

  await db.collection("rapex_leads").doc(encodeURIComponent(domain)).set(leadDoc, { merge: true });
  console.log(`[${domain}] Scan Finished in ${durationSec}s -> Score: ${leadDoc.leadScore}, Priority: ${leadDoc.priorityLevel}, Matches: ${leadDoc.flaggedProductsCount}`);
}

async function runAll() {
  const storesToScan = [
    "charlieundlu.de",
    "snowwhite-mini.de",
    "mimitoys.ie",
    "scallywags.ie",
    "littlethingz.be",
    "leobabys.com",
    "thetoysstore.it",
  ];

  for (const store of storesToScan) {
    await scanStore(store, 80);
  }
  console.log("\n==================================================");
  console.log("ALL SCANS COMPLETED SUCCESSFULLY!");
  console.log("==================================================");
}

runAll().catch(console.error);
