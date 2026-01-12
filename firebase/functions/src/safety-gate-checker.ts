import { genkit, z, type Part } from 'genkit';
import type { DocumentData, RetrieverAction } from 'genkit/retriever';
import { googleAI } from '@genkit-ai/googleai';
import { defineFirestoreRetriever } from '@genkit-ai/firebase';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import axios from 'axios';

// Initialize Genkit with Google AI
const ai = genkit({
  plugins: [googleAI()],
});

const ALERT_LOOKBACK_DAYS = 365; // Only compare against alerts from the last year
const RAG_TEXT_LIMIT = 12;
const RAG_IMAGE_LIMIT = 6;
const MAX_RAG_ALERTS = 12;
const VECTOR_TEXT_FIELD = 'vector_text';
const VECTOR_IMAGE_FIELD = 'vector_image';

type EncodedImage = {
  url: string;
  contentType?: string;
};

type NormalizedAlert = {
  id: string;
  meta: {
    recordid: string;
    alert_date: string;
    ingested_at: string;
  };
  fields: {
    product_category: string;
    product_description: string;
    risk_level: string;
    alert_level: string;
    alert_type: string;
    risk_legal_provision: string;
    notifying_country: string;
    product_brand?: string;
    product_model?: string;
    pictures?: string[];
  };
  distance?: number;
  source?: 'retriever' | 'recent';
};

let textRetriever: RetrieverAction | null = null;
let imageRetriever: RetrieverAction | null = null;

function guessContentType(url: string): string | undefined {
  const lower = url.toLowerCase();
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.gif')) return 'image/gif';
  return undefined;
}

function normalizeTimestamp(value: any): string {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value.toDate === 'function') return value.toDate().toISOString();
  return String(value);
}

function normalizePictures(fields: any): string[] {
  const normalizedPictures = [
    ...(Array.isArray(fields?.pictures) ? fields.pictures : []),
    ...(fields?.product_image ? [fields.product_image] : []),
    ...(typeof fields?.product_other_images === 'string'
      ? fields.product_other_images.split(',')
      : []),
  ]
    .map((pic: any) => (typeof pic === 'string' ? pic.trim() : pic))
    .filter(Boolean);

  return normalizedPictures;
}

function ensureTextRetriever(): RetrieverAction | null {
  if (textRetriever) return textRetriever;

  try {
    textRetriever = defineFirestoreRetriever(ai, {
      name: 'rapex-text-retriever',
      firestore: getFirestore(),
      collection: 'rapex_alerts',
      embedder: 'googleai/text-embedding-004',
      vectorField: VECTOR_TEXT_FIELD,
      contentField: 'fields.product_description',
      distanceResultField: 'distance',
    });
  } catch (error) {
    console.warn('Unable to initialize text retriever; falling back to DB scan', error);
    textRetriever = null;
  }

  return textRetriever;
}

function ensureImageRetriever(): RetrieverAction | null {
  if (imageRetriever) return imageRetriever;

  try {
    imageRetriever = defineFirestoreRetriever(ai, {
      name: 'rapex-image-retriever',
      firestore: getFirestore(),
      collection: 'rapex_alerts',
      embedder: 'googleai/multimodalembedding@001',
      vectorField: VECTOR_IMAGE_FIELD,
      contentField: 'fields.product_description',
      distanceResultField: 'distance',
    });
  } catch (error) {
    console.warn('Unable to initialize image retriever; image similarity will be skipped', error);
    imageRetriever = null;
  }

  return imageRetriever;
}

function normalizeRetrieverDocument(doc: DocumentData): NormalizedAlert | null {
  const metadata: any = (doc as any)?.metadata || {};
  const metaSection: any = metadata.meta || metadata;
  const fieldsSection: any = metadata.fields || {};

  const recordId = String(
    metaSection.recordid ??
      metadata.recordid ??
      metadata.id ??
      metaSection.id ??
      ''
  );
  const alertId = recordId || String(metadata.id || '');

  if (!alertId) {
    return null;
  }

  const pictures = normalizePictures(fieldsSection);

  return {
    id: alertId,
    meta: {
      recordid: recordId || alertId,
      alert_date: normalizeTimestamp(metaSection.alert_date || metadata.alert_date),
      ingested_at: normalizeTimestamp(metaSection.ingested_at || metadata.ingested_at),
    },
    fields: {
      product_category: String(fieldsSection.product_category || ''),
      product_description: String(fieldsSection.product_description || ''),
      risk_level: String(fieldsSection.risk_level || ''),
      alert_level: String(fieldsSection.alert_level || ''),
      alert_type: String(fieldsSection.alert_type || ''),
      risk_legal_provision: String(fieldsSection.risk_legal_provision || ''),
      notifying_country: String(fieldsSection.notifying_country || ''),
      product_brand: fieldsSection.product_brand != null ? String(fieldsSection.product_brand) : undefined,
      product_model: fieldsSection.product_model != null ? String(fieldsSection.product_model) : undefined,
      pictures,
    },
    distance: metadata.distance,
    source: 'retriever',
  };
}

async function retrieveAlertsWithRag(
  product: z.infer<typeof ProductInputSchema>
): Promise<NormalizedAlert[]> {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - ALERT_LOOKBACK_DAYS);

  const candidates: NormalizedAlert[] = [];
  const seen = new Set<string>();

  const textR = ensureTextRetriever();
  const imageR = ensureImageRetriever();

  if (!textR && !imageR) {
    return [];
  }

  if (textR) {
    try {
      const result = await ai.retrieve({
        retriever: textR,
        query: product.description,
        options: { limit: RAG_TEXT_LIMIT },
      });
      for (const doc of result || []) {
        const normalized = normalizeRetrieverDocument(doc);
        if (!normalized || seen.has(normalized.id)) continue;

        const alertDate = normalized.meta.alert_date ? new Date(normalized.meta.alert_date) : null;
        if (alertDate && !Number.isNaN(alertDate.getTime()) && alertDate < cutoffDate) {
          continue;
        }

        seen.add(normalized.id);
        candidates.push(normalized);
      }
    } catch (error) {
      console.warn('Text retriever query failed; falling back to DB scan', error);
    }
  }

  if (imageR && product.imageUrl) {
    const encodedImage = await prepareImageMedia(product.imageUrl);
    if (encodedImage) {
      try {
        const result = await ai.retrieve({
          retriever: imageR,
          query: { content: [{ media: encodedImage }] },
          options: { limit: RAG_IMAGE_LIMIT },
        });
        for (const doc of result || []) {
          const normalized = normalizeRetrieverDocument(doc);
          if (!normalized || seen.has(normalized.id)) continue;

          const alertDate = normalized.meta.alert_date ? new Date(normalized.meta.alert_date) : null;
          if (alertDate && !Number.isNaN(alertDate.getTime()) && alertDate < cutoffDate) {
            continue;
          }

          seen.add(normalized.id);
          candidates.push(normalized);
        }
      } catch (error) {
        console.warn('Image retriever query failed; continuing without image recall', error);
      }
    }
  }

  candidates.sort((a, b) => {
    const aDistance = typeof a.distance === 'number' ? a.distance : Number.POSITIVE_INFINITY;
    const bDistance = typeof b.distance === 'number' ? b.distance : Number.POSITIVE_INFINITY;
    return aDistance - bDistance;
  });

  return candidates.slice(0, MAX_RAG_ALERTS);
}

// Define input/output schemas
const ProductInputSchema = z.object({
  name: z.string().describe('Product name'),
  category: z.string().describe('Product category (toys, electronics, etc.)'),
  description: z.string().describe('Product description'),
  imageUrl: z.string().optional().describe('URL to product image'),
  brand: z.string().optional().describe('Product brand'),
  model: z.string().optional().describe('Product model'),
});

const RapexAlertSchema = z.object({
  meta: z.object({
    recordid: z.string(),
    alert_date: z.string(),
    ingested_at: z.string(),
  }),
  fields: z.object({
    product_category: z.string(),
    product_description: z.string(),
    risk_level: z.string(),
    alert_level: z.string(),
    alert_type: z.string(),
    risk_legal_provision: z.string(),
    notifying_country: z.string(),
    product_brand: z.string().optional(),
    product_model: z.string().optional(),
    product_image: z.string().optional(),
    product_other_images: z.string().optional(),
    pictures: z.array(z.string()).optional(),
  }),
});

const MatchSchema = z.object({
  alertId: z.string(),
  similarity: z.number(),
  riskLevel: z.string(),
  alertType: z.string(),
  riskLegalProvision: z.string(),
  reason: z.string(),
  alertDetails: RapexAlertSchema,
});

const SafetyCheckResultSchema = z.object({
  isSafe: z.boolean(),
  warnings: z.array(MatchSchema),
  recommendation: z.string(),
  checkedAt: z.string(),
});

// Function to search recent Safety Gate alerts
async function searchRecentRapexAlerts(days = ALERT_LOOKBACK_DAYS): Promise<NormalizedAlert[]> {
  const db = getFirestore();
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);

  console.log(`Searching Safety Gate alerts from ${cutoffDate.toISOString()} to now...`);

  const alertsSnapshot = await db.collection('rapex_alerts')
    .where('meta.alert_date', '>=', Timestamp.fromDate(cutoffDate))
    .orderBy('meta.alert_date', 'desc')
    .limit(100)
    .get();

  console.log(`Found ${alertsSnapshot.docs.length} recent Safety Gate alerts`);

  return alertsSnapshot.docs.map(doc => {
    const data = doc.data() as any;
    const meta = data.meta || {};
    const fields = data.fields || {};

    // Normalize meta timestamps to strings (ISO)
    const normalizedMeta = {
      ...meta,
      recordid: String(meta.recordid || doc.id),
      alert_date: meta.alert_date && typeof meta.alert_date.toDate === 'function'
        ? meta.alert_date.toDate().toISOString()
        : String(meta.alert_date || ''),
      ingested_at: meta.ingested_at && typeof meta.ingested_at.toDate === 'function'
        ? meta.ingested_at.toDate().toISOString()
        : String(meta.ingested_at || ''),
    };

    // Ensure required field strings exist
    const normalizedFields = {
      ...fields,
      product_category: String(fields.product_category || ''),
      product_description: String(fields.product_description || ''),
      risk_level: String(fields.risk_level || ''),
      alert_level: String(fields.alert_level || ''),
      alert_type: String(fields.alert_type || ''),
      risk_legal_provision: String(fields.risk_legal_provision || ''),
      notifying_country: String(fields.notifying_country || ''),
      // Optional fields preserved as strings if present
      product_brand: fields.product_brand != null ? String(fields.product_brand) : undefined,
      product_model: fields.product_model != null ? String(fields.product_model) : undefined,
    } as any;

    normalizedFields.pictures = normalizePictures(fields);

    return {
      id: doc.id,
      meta: normalizedMeta,
      fields: normalizedFields,
      source: 'recent' as const,
    };
  });
}

// Always use data URI to have control over content-type and avoid charset issues
// Some servers (e.g., Shopify CDN) incorrectly include charset in Content-Type for images
// Gemini API doesn't support charset parameter for image MIME types
async function prepareImageMedia(imageUrl: string): Promise<EncodedImage | null> {
  if (typeof imageUrl !== 'string' || !imageUrl.trim()) return null;

  const trimmed = imageUrl.trim();
  
  // Always load image and use data URI to ensure proper content-type without charset
  // This avoids issues when Genkit SDK loads images from URLs and receives charset in headers
  try {
    const response = await axios.get(trimmed, {
      responseType: 'arraybuffer',
      timeout: 10000,
    });

    const base64 = Buffer.from(response.data, 'binary').toString('base64');
    let contentType = response.headers['content-type'] || guessContentType(trimmed) || 'application/octet-stream';
    
    // Remove charset parameter from image MIME types (Gemini API doesn't support it)
    if (contentType.startsWith('image/')) {
      contentType = contentType.split(';')[0].trim();
    }
    
    return {
      url: `data:${contentType};base64,${base64}`,
      contentType,
    };
  } catch (error) {
    console.warn(`Failed to load image from ${trimmed}:`, error instanceof Error ? error.message : String(error));
    return null;
  }
}

function isUnsupportedMimeError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error ?? '');
  return msg.toLowerCase().includes('unsupported mime type');
}

// Main product safety checker flow
export const checkProductSafety = ai.defineFlow(
  {
    name: 'checkProductSafety',
    inputSchema: ProductInputSchema,
    outputSchema: SafetyCheckResultSchema,
  },

  async (product: z.infer<typeof ProductInputSchema>) => {
    console.log('Checking product safety:', product.name);

    // Step 1: Prefer RAG (vector) retrieval, fallback to recent alerts scan
    const ragAlerts = await retrieveAlertsWithRag(product);
    const recentAlerts = ragAlerts.length > 0
      ? ragAlerts
      : await searchRecentRapexAlerts(ALERT_LOOKBACK_DAYS);

    if (recentAlerts.length === 0) {
      return {
        isSafe: true,
        warnings: [],
        recommendation: 'No recent Safety Gate alerts found. Product appears safe based on available data.',
        checkedAt: new Date().toISOString(),
      };
    }

    // Step 2: Prepare comparison data
    const alertsText = recentAlerts.map(alert => {
      const distanceLabel = typeof alert.distance === 'number'
        ? ` (distance: ${alert.distance.toFixed(4)})`
        : '';

      const sourceLabel = alert.source === 'retriever'
        ? `Source: vector retriever${distanceLabel}`
        : 'Source: recent time-filtered scan';

      return `Alert ID: ${alert.id}
Product: ${alert.fields.product_description}
Category: ${alert.fields.product_category}
Brand: ${alert.fields.product_brand || 'Unknown'}
Risk Level: ${alert.fields.risk_level}
Country: ${alert.fields.notifying_country}
${sourceLabel}`;
    }).join('\n\n');

    // Step 3: Create comparison prompt
    let comparisonPrompt = `You are a product safety expert analyzing potential matches between a new product and existing RAPEX alerts.

NEW PRODUCT TO CHECK:
Name: ${product.name}
Category: ${product.category}
Description: ${product.description}
Brand: ${product.brand || 'Not specified'}
Model: ${product.model || 'Not specified'}

RECENT SAFETY GATE ALERTS (last 12 months):
${alertsText}

TASK:
1. Compare the new product with each Safety Gate alert
2. Prioritize alerts from the last year only; ignore older records.
3. If images are provided, use visual similarity alongside the text fields.
4. For each potential match, provide:
   - Similarity score (0-100, where 100 is identical)
   - Reason for the match
   - Risk assessment

Return ONLY a JSON array of matches where similarity > 50. Each match should have:
- alertId: the Safety Gate alert ID
- similarity: similarity score (50-100)
- reason: detailed explanation of why you think this is a match
- riskAssessment: assessment of the risk level

If no matches found, return empty array.`;

    // Step 4: Build prompt parts (always using data URI to control content-type)
    const buildPromptParts = async (): Promise<Part[]> => {
      const parts: Part[] = [
        { text: 'System: Return ONLY a JSON array of matches; no prose.' },
        { text: comparisonPrompt },
      ];

      const productImage = product.imageUrl
        ? await prepareImageMedia(product.imageUrl)
        : null;

      if (productImage) {
        parts.push({ text: 'Product reference image:' });
        parts.push({ media: productImage });
      }

      const alertImages: Array<{ alertId: string; media: EncodedImage }> = [];
      for (const alert of recentAlerts) {
        const pictures = Array.isArray((alert as any).fields?.pictures)
          ? (alert as any).fields.pictures as any[]
          : [];
        const firstPicture = pictures.find((pic) => typeof pic === 'string' && pic.trim());
        if (!firstPicture) continue;

        const encoded = await prepareImageMedia(firstPicture as string);
        if (encoded) {
          alertImages.push({ alertId: alert.id, media: encoded });
        }

        if (alertImages.length >= 2) {
          break; // limit payload size
        }
      }

      if (alertImages.length > 0) {
        parts.push({ text: 'Reference Safety Gate alert images (match them to the alert IDs above):' });
        for (const image of alertImages) {
          parts.push({ text: `Alert ${image.alertId} image:` });
          parts.push({ media: image.media });
        }
      }

      return parts;
    };

    const promptParts = await buildPromptParts();

    // Step 5: Use Gemini to analyze similarities with layered fallbacks
    const attempts = [
      { model: 'gemini-2.5-flash', promptType: 'multimodal', label: '2.5 multimodal' },
      { model: 'gemini-2.5-flash', promptType: 'text', label: '2.5 text-only' },
      { model: 'gemini-1.5-flash-002', promptType: 'multimodal', label: '1.5 multimodal' },
      { model: 'gemini-1.5-flash-002', promptType: 'text', label: '1.5 text-only' },
    ] as const;

    let analysisResponse: any = null;
    for (const attempt of attempts) {
      const prompt = attempt.promptType === 'text'
        ? comparisonPrompt
        : promptParts;

      try {
        analysisResponse = await ai.generate({
          model: googleAI.model(attempt.model),
          prompt,
          config: {
            temperature: 0.1, // Low temperature for consistent analysis
          },
          output: { schema: z.array(MatchSchema) },
        });
        break;
      } catch (error) {
        const mimeIssue = isUnsupportedMimeError(error);
        console.error(`Analysis attempt failed (${attempt.label})${mimeIssue ? ' [unsupported mime]' : ''}; trying next`, error);
      }
    }

    if (!analysisResponse) {
      return {
        isSafe: true,
        warnings: [],
        recommendation: 'Unable to analyze product against Safety Gate alerts at this time.',
        checkedAt: new Date().toISOString(),
      };
    }

    console.log('Gemini analysis response:', analysisResponse.text);

    // Step 6: Parse the response via schema (avoid regex fallback)
    let matches: any[] = [];
    if (Array.isArray(analysisResponse.output)) {
      matches = analysisResponse.output;
    } else {
      try {
        const parsed = JSON.parse(analysisResponse.text);
        matches = Array.isArray(parsed) ? parsed : [];
      } catch (error) {
        console.error('Failed to parse Gemini response:', error);
        matches = [];
      }
    }

    // Step 7: Build final result
    const warnings = matches.map((match: any) => {
      const alert = recentAlerts.find(a => a.id === match.alertId);
      const defaultAlert = {
        meta: { recordid: '', alert_date: '', ingested_at: '' },
        fields: { product_category: '', product_description: '', risk_level: '', alert_level: '', alert_type: '', risk_legal_provision: '', notifying_country: '' },
      };
      const alertDetails = alert ? {
        meta: {
          ...alert.meta,
          recordid: String(alert.meta?.recordid || alert.id || ''),
          alert_date: String(alert.meta?.alert_date || ''),
          ingested_at: String(alert.meta?.ingested_at || ''),
        },
        fields: {
          ...(alert.fields || {}),
          product_category: String(alert.fields?.product_category || ''),
          product_description: String(alert.fields?.product_description || ''),
          risk_level: String(alert.fields?.risk_level || ''),
          alert_level: String(alert.fields?.alert_level || ''),
          alert_type: String(alert.fields?.alert_type || ''),
          risk_legal_provision: String(alert.fields?.risk_legal_provision || ''),
          notifying_country: String(alert.fields?.notifying_country || ''),
        },
      } : defaultAlert;

      // Map risk level from database to standard values
      const mapRiskLevel = (dbRiskLevel: string): string => {
        console.log('Raw risk_level from database:', JSON.stringify(dbRiskLevel));

        if (!dbRiskLevel) return 'unknown';

        const normalized = dbRiskLevel.toLowerCase().trim();
        console.log('Normalized risk_level:', JSON.stringify(normalized));

        // Map common variations to standard values
        if (normalized.includes('serious') || normalized === '1') return 'serious';
        if (normalized.includes('high') || normalized === '2') return 'high';
        if (normalized.includes('medium') || normalized === '3') return 'medium';
        if (normalized.includes('low') || normalized === '4') return 'low';

        // If it's already a standard value, return as is
        if (['serious', 'high', 'medium', 'low'].includes(normalized)) {
          return normalized;
        }

        console.log('Unknown risk_level, returning unknown');
        return 'unknown';
      };

      const alertType = (alertDetails.fields as any)?.alert_type;
      const alertLevel = (alertDetails.fields as any)?.alert_level;
      const riskLegalProvision = (alertDetails.fields as any)?.risk_legal_provision;

      return {
        alertId: match.alertId || '',
        similarity: match.similarity || 0,
        riskLevel: mapRiskLevel((alertDetails.fields as any)?.risk_level || ''),
        alertType: alertType || alertLevel || 'Unknown',
        riskLegalProvision: riskLegalProvision || '',
        reason: match.reason || 'Potential similarity detected',
        alertDetails,
      };
    }).filter((warning: any) => warning.similarity > 30);

    const isSafe = warnings.length === 0;

    let recommendation = '';
    if (isSafe) {
      recommendation = 'Product appears safe based on Safety Gate database analysis. No significant matches found.';
    } else {
      const highRiskWarnings = warnings.filter((w: any) => w.riskLevel === 'serious' || w.riskLevel === 'high');
      if (highRiskWarnings.length > 0) {
        recommendation = '⚠️ HIGH RISK: Found serious safety alerts for similar products. Recommend avoiding purchase and consulting authorities.';
      } else {
        recommendation = '⚡ CAUTION: Found alerts for similar products. Review safety concerns before purchase.';
      }
    }

    return {
      isSafe,
      warnings,
      recommendation,
      checkedAt: new Date().toISOString(),
    };
  }
);

console.log('Product safety checker flow defined successfully!');
