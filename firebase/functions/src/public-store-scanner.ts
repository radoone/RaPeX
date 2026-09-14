import * as logger from "firebase-functions/logger";
import { db } from "./firebase-admin.js";
import { checkProductAgainstAlerts } from "./safety-gate-checker.js";
import type { ProductInput, SafetyCheckResult } from "./safety-gate-checker.schemas.js";
import { buildEmbeddingText, embedTexts } from "./safety-gate-embeddings.js";
import { retrieveAlertsForVector } from "./safety-gate-checker-retrieval.js";
import type { NormalizedAlert } from "./safety-gate-checker.types.js";

type RequestShape = {
  method: string;
  body?: Record<string, unknown>;
  headers: Record<string, string | string[] | undefined>;
  query: Record<string, unknown>;
};

type ResponseShape = {
  set(name: string, value: string): void;
  status(code: number): ResponseShape;
  json(payload: unknown): void;
  send(payload: string): void;
};

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-API-Key, Authorization",
} as const;

function applyCorsHeaders(response: ResponseShape): void {
  for (const [name, value] of Object.entries(CORS_HEADERS)) {
    response.set(name, value);
  }
}

function coerceString(value: unknown): string | undefined {
  if (Array.isArray(value)) return coerceString(value[0]);
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function extractApiKey(request: RequestShape): string {
  const headerKey = coerceString(request.headers["x-api-key"]);
  if (headerKey) return headerKey;

  const authHeader = coerceString(request.headers["authorization"]);
  if (authHeader && authHeader.toLowerCase().startsWith("bearer ")) {
    return authHeader.slice(7).trim();
  }
  return "";
}

function normalizeDomain(input: string): string {
  let cleaned = input.trim().toLowerCase();
  cleaned = cleaned.replace(/^https?:\/\//i, "");
  cleaned = cleaned.replace(/\/.*$/, "");
  return cleaned;
}

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

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function extractContactEmail(domain: string): Promise<string | null> {
  const baseUrl = `https://${domain}`;
  const candidates = new Set<string>();

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

      let match: RegExpExecArray | null;
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

      const matchingDomainEmail = Array.from(candidates).find((e) => e.includes(domain));
      if (matchingDomainEmail) {
        return matchingDomainEmail;
      }
    } catch (err: unknown) {
      // Ignore network errors fetching individual optional contact pages
      void err;
    }
  }

  const all = Array.from(candidates);
  return all.find((e) => e.includes(domain)) || all[0] || null;
}

function normalizeTags(tags: unknown): string[] {
  if (Array.isArray(tags)) return tags.filter((t): t is string => typeof t === "string");
  if (typeof tags === "string") return tags.split(",").map((t) => t.trim()).filter(Boolean);
  return [];
}

function stripHtml(val: unknown): string {
  if (typeof val !== "string") return "";
  return val.replace(/<[^>]*>/g, "").trim();
}

function shopifyRawToProductInput(raw: any, shop: string): ProductInput {
  const tags = normalizeTags(raw?.tags);
  const category = raw.product_type || raw.productType || tags.find((t) =>
    ['toys', 'electronics', 'clothing', 'cosmetics', 'food', 'jewelry'].includes(t.toLowerCase())
  ) || 'general';

  const description = stripHtml(raw.body_html || raw.description || raw.title || "");
  const images = Array.isArray(raw.images) ? raw.images.map((img: any) => typeof img === "string" ? img : img?.src).filter(Boolean) : [];
  const brand = raw.vendor || tags.find((t) => t.toLowerCase().includes("brand:"))?.replace(/brand:\s*/i, "");

  return {
    name: String(raw.title || "Untitled product"),
    category: category.toLowerCase(),
    description,
    imageUrl: images[0],
    imageUrls: images.slice(0, 4),
    brand,
    shop,
    productId: String(raw.id || raw.handle || ""),
  };
}

async function fetchStoreCatalog(domain: string, maxProducts = 250): Promise<any[]> {
  const products: any[] = [];
  let page = 1;
  const perPage = Math.min(maxProducts, 250);

  while (products.length < maxProducts) {
    const fetchUrl = `https://${domain}/products.json?limit=${perPage}&page=${page}`;
    try {
      const res = await fetch(fetchUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
          "Accept": "application/json",
          "Accept-Language": "sk,cs;q=0.9,en;q=0.8",
        },
      });

      if (res.status === 429) {
        logger.warn(`Rate limit 429 on page ${page} for ${domain}, waiting 4s...`);
        await sleep(4000);
        continue;
      }

      if (!res.ok) {
        break;
      }

      const data = await res.json() as { products?: any[] };
      const pageProds = data.products || [];
      if (pageProds.length === 0) break;

      products.push(...pageProds);
      if (pageProds.length < perPage || products.length >= maxProducts) break;

      page += 1;
      await sleep(2500); // 2.5s polite delay between pages
    } catch (err: any) {
      logger.warn(`Failed fetching page ${page} from ${domain}:`, err);
      break;
    }
  }

  return products.slice(0, maxProducts);
}

function computeScore(
  totalProductsScanned: number,
  flaggedMatches: Array<{ result: SafetyCheckResult }>,
) {
  const flaggedCount = flaggedMatches.length;
  if (flaggedCount === 0 || totalProductsScanned === 0) {
    return {
      leadScore: 0,
      priorityLevel: "SAFE" as const,
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

  const priorityLevel = leadScore >= 75 || seriousRiskCount > 0 ? ("CRITICAL" as const) : leadScore >= 50 ? ("HIGH" as const) : ("MEDIUM" as const);

  return {
    leadScore,
    priorityLevel,
    totalWarningsCount,
    seriousRiskCount,
    highestSimilarity,
    summary: `Found ${flaggedCount} product(s) matching Safety Gate alerts (${seriousRiskCount} serious violations, highest similarity ${highestSimilarity}%).`,
  };
}

export async function handleScanPublicShopifyStoreRequest(
  request: RequestShape,
  response: ResponseShape,
): Promise<void> {
  applyCorsHeaders(response);

  if (request.method === "OPTIONS") {
    response.status(204).send("");
    return;
  }

  const expectedKey = (process.env.SAFETY_GATE_API_KEY ?? "").trim();
  const providedKey = extractApiKey(request);

  if (expectedKey && providedKey !== expectedKey) {
    response.status(401).json({ error: "Unauthorized. Valid API key required." });
    return;
  }

async function enrichLeadMatches(matches: any[], leadDomain?: string): Promise<any[]> {
  if (!matches || !matches.length) return [];
  const alertIds = [...new Set(matches.map((m) => m.result?.warnings?.[0]?.alertId).filter(Boolean))];
  if (!alertIds.length) return matches;

  const alertDocs = await Promise.all(
    alertIds.map((id) => db.collection("rapex_alerts").doc(id).get())
  );
  const alertMap = new Map<string, any>();
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

  if (request.method === "GET") {
    try {
      const snapshot = await db
        .collection("rapex_leads")
        .orderBy("updatedAt", "desc")
        .limit(100)
        .get();
      const leads = await Promise.all(
        snapshot.docs.map(async (doc) => {
          const data = doc.data();
          if (data.matches && data.matches.length) {
            data.matches = await enrichLeadMatches(data.matches, data.domain);
          }
          return data;
        })
      );
      response.status(200).json({ success: true, leads });
      return;
    } catch (err: unknown) {
      logger.error("Failed to list leads:", err);
      response.status(500).json({ error: "Failed to list leads." });
      return;
    }
  }

  if (request.method !== "POST") {
    response.status(405).json({ error: "Method not allowed. Only GET and POST are supported." });
    return;
  }

  const body = request.body || {};
  const rawDomain = coerceString(body.domain);
  const maxProducts = typeof body.maxProducts === "number" ? Math.min(body.maxProducts, 1000) : 100;
  const similarityThreshold = typeof body.similarityThreshold === "number" ? body.similarityThreshold : 50;

  if (!rawDomain) {
    response.status(400).json({ error: "Missing required 'domain' parameter." });
    return;
  }

  const domain = normalizeDomain(rawDomain);
  logger.info(`Starting batch vectorized public store scan for ${domain} (maxProducts=${maxProducts})...`);

  try {
    // 1. Concurrently fetch catalog and search for contact email in Google Cloud
    const [rawProducts, contactEmail] = await Promise.all([
      fetchStoreCatalog(domain, maxProducts),
      extractContactEmail(domain),
    ]);

    logger.info(`Fetched ${rawProducts.length} products from ${domain}, contactEmail: ${contactEmail}`);

    // 2. Build product inputs and prepare text representation for batch vectorization
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

    // 3. Batch embed texts in chunks (e.g. 50 items per batch)
    logger.info(`Generating text embeddings in batch for ${productInputs.length} products...`);
    const allVectors: Array<number[] | undefined> = [];
    const EMBED_BATCH_SIZE = 50;
    for (let i = 0; i < embeddingTexts.length; i += EMBED_BATCH_SIZE) {
      const chunk = embeddingTexts.slice(i, i + EMBED_BATCH_SIZE);
      const vectors = await embedTexts(chunk);
      allVectors.push(...vectors);
    }

    // 4. Fast Firestore KNN Retrieval to filter candidates (Cosine Distance <= 0.22)
    logger.info(`Running fast Firestore vector nearest-neighbor search for candidate alerts...`);
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
              raw: rawProducts[globalIdx],
              candidateAlerts,
            });
          }
        })
      );
    }

    logger.info(
      `Vector pre-filtering complete: ${candidatePairs.length} / ${productInputs.length} products require AI evaluation.`
    );

    // 5. Targeted LLM evaluation (Gemini 2.5 Flash) ONLY on candidate pairs
    const matches: any[] = [];
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
            logger.warn(`Candidate AI check failed for ${candidate.raw.title}:`, checkErr);
          }
        })
      );
    }

    // 6. Compute score and save lead document in Firestore
    const scoreResult = computeScore(rawProducts.length, matches);
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
      matches,
      contactEmail: contactEmail || undefined,
      scannedAt: now,
      updatedAt: now,
    };

    await db.collection("rapex_leads").doc(encodeURIComponent(domain)).set(leadDoc, { merge: true });

    logger.info(`Completed scan for ${domain}: score=${leadDoc.leadScore}, flagged=${leadDoc.flaggedProductsCount}`);

    response.status(200).json({
      success: true,
      lead: leadDoc,
    });
  } catch (error: any) {
    logger.error(`Public store scan failed for ${domain}:`, error);
    response.status(500).json({
      error: error instanceof Error ? error.message : "Public store scan failed",
    });
  }
}
