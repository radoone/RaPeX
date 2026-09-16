import { FieldValue } from "firebase-admin/firestore";
import { db } from "./lib/firebase-admin.js";
import { checkProductAgainstAlerts } from "./lib/safety-gate-checker.js";
import { retrieveAlertsForVector } from "./lib/safety-gate-checker-retrieval.js";

function asVectorArray(value) {
  if (!value || typeof value !== "object") return undefined;
  if (typeof value.toArray === "function") return value.toArray();
  if (Array.isArray(value._values)) return value._values;
  return undefined;
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

async function evaluateStore(domain, similarityThreshold = 80) {
  console.log(`\n==================================================`);
  console.log(`EVALUATING STORE: ${domain}`);
  console.log(`==================================================`);

  const productsSnap = await db
    .collection("rapex_leads")
    .doc(domain)
    .collection("products")
    .get();

  console.log(`Loaded ${productsSnap.docs.length} products from Firestore for ${domain}.`);

  const products = [];
  for (const doc of productsSnap.docs) {
    const data = doc.data();
    const vec = asVectorArray(data.vector_text);
    if (vec && vec.length > 0) {
      products.push({
        productId: doc.id,
        ...data,
        vector: vec,
        pInput: {
          name: data.title,
          category: data.category || "general",
          description: data.description || "",
          imageUrl: data.imageUrl,
          imageUrls: data.imageUrls || [],
          brand: data.brand,
          shop: domain,
          productId: doc.id,
        }
      });
    }
  }

  console.log(`Finding candidate alerts via Firestore KNN (Distance <= 0.22)...`);
  const candidatePairs = [];
  const KNN_BATCH = 25;

  for (let i = 0; i < products.length; i += KNN_BATCH) {
    const chunk = products.slice(i, i + KNN_BATCH);
    await Promise.all(
      chunk.map(async (prod) => {
        const candidateAlerts = await retrieveAlertsForVector(prod.vector, 5);
        if (candidateAlerts.length > 0) {
          candidatePairs.push({ prod, candidateAlerts });
        }
      })
    );
    process.stdout.write(`\rKNN Progress: ${Math.min(i + KNN_BATCH, products.length)} / ${products.length} (Candidates: ${candidatePairs.length})`);
  }
  console.log(`\nFound ${candidatePairs.length} candidate products requiring AI analysis.`);

  const matches = [];
  const AI_BATCH = 3;

  for (let i = 0; i < candidatePairs.length; i += AI_BATCH) {
    const chunk = candidatePairs.slice(i, i + AI_BATCH);
    await Promise.all(
      chunk.map(async ({ prod, candidateAlerts }) => {
        try {
          const checkResult = await checkProductAgainstAlerts(prod.pInput, candidateAlerts);
          const filteredWarnings = checkResult.warnings.filter(
            (w) => (w.overallSimilarity || 0) >= similarityThreshold
          );

          if (filteredWarnings.length > 0) {
            console.log(`\n🚨 MATCH DETECTED (${filteredWarnings[0].overallSimilarity}%): ${prod.title}`);
            console.log(`   Reason: ${filteredWarnings[0].reason}`);

            matches.push({
              productId: prod.productId,
              productTitle: prod.title,
              productUrl: prod.handle ? `https://${domain}/products/${prod.handle}` : `https://${domain}/search?q=${encodeURIComponent(prod.title || "")}`,
              productImage: prod.imageUrl,
              vendor: prod.brand,
              productType: prod.category,
              result: {
                ...checkResult,
                warnings: filteredWarnings,
                isSafe: false,
              },
            });
          }
        } catch (err) {
          console.warn(`Check error for ${prod.title}:`, err.message);
        }
      })
    );
    process.stdout.write(`\rAI Evaluation Progress: ${Math.min(i + AI_BATCH, candidatePairs.length)} / ${candidatePairs.length} (Matches: ${matches.length})`);
  }

  console.log(`\nFinished AI evaluation for ${domain}. Total matches: ${matches.length}`);

  const enrichedMatches = await enrichLeadMatches(matches, domain);
  const scoreResult = computeScore(products.length, enrichedMatches);
  const now = new Date().toISOString();

  const leadRef = db.collection("rapex_leads").doc(domain);
  const existingDoc = (await leadRef.get()).data() || {};

  const leadDoc = {
    ...existingDoc,
    domain,
    storeUrl: `https://${domain}`,
    status: matches.length > 0 ? "review_needed" : "new",
    leadScore: scoreResult.leadScore,
    priorityLevel: scoreResult.priorityLevel,
    totalProductsScanned: products.length,
    flaggedProductsCount: matches.length,
    totalWarningsCount: scoreResult.totalWarningsCount,
    seriousRiskCount: scoreResult.seriousRiskCount,
    highestSimilarity: scoreResult.highestSimilarity,
    summary: scoreResult.summary,
    matches: enrichedMatches,
    updatedAt: now,
    scanProgress: {
      stage: "completed",
      percent: 100,
      message: `Sken dokončený. Preverených ${products.length} produktov, zistených ${matches.length} záchytov.`,
    },
  };

  await leadRef.set(leadDoc, { merge: true });
  console.log(`Saved lead doc for ${domain} -> Score: ${leadDoc.leadScore}, Priority: ${leadDoc.priorityLevel}, Matches: ${leadDoc.flaggedProductsCount}`);
}

async function run() {
  await evaluateStore("4kidspoint.sk", 80);
}

run().catch(console.error);
