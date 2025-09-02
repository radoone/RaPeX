import { genkit, z } from 'genkit';
import { googleAI } from '@genkit-ai/googleai';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import axios from 'axios';

// Initialize Genkit with Google AI
const ai = genkit({
  plugins: [googleAI()],
});

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
    notifying_country: z.string(),
    product_brand: z.string().optional(),
    product_model: z.string().optional(),
  }),
});

const SafetyCheckResultSchema = z.object({
  isSafe: z.boolean(),
  warnings: z.array(z.object({
    alertId: z.string(),
    similarity: z.number(),
    riskLevel: z.string(),
    reason: z.string(),
    alertDetails: RapexAlertSchema,
  })),
  recommendation: z.string(),
  checkedAt: z.string(),
});

// Function to search recent RAPEX alerts
async function searchRecentRapexAlerts(days: number = 7) {
  const db = getFirestore();
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);

  console.log(`Searching RAPEX alerts from ${cutoffDate.toISOString()} to now...`);

  const alertsSnapshot = await db.collection('rapex_alerts')
    .where('meta.alert_date', '>=', Timestamp.fromDate(cutoffDate))
    .orderBy('meta.alert_date', 'desc')
    .limit(100)
    .get();

  console.log(`Found ${alertsSnapshot.docs.length} recent RAPEX alerts`);

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
      product_category: String(fields.product_category || ''),
      product_description: String(fields.product_description || ''),
      risk_level: String(fields.risk_level || ''),
      notifying_country: String(fields.notifying_country || ''),
      // Optional fields preserved as strings if present
      product_brand: fields.product_brand != null ? String(fields.product_brand) : undefined,
      product_model: fields.product_model != null ? String(fields.product_model) : undefined,
      ...fields,
    };

    return {
      id: doc.id,
      meta: normalizedMeta,
      fields: normalizedFields,
    };
  });
}

// Function to download image as base64
async function downloadImageAsBase64(imageUrl: string): Promise<string | null> {
  try {
    const response = await axios.get(imageUrl, {
      responseType: 'arraybuffer',
      timeout: 10000,
    });

    const base64 = Buffer.from(response.data, 'binary').toString('base64');
    return `data:${response.headers['content-type']};base64,${base64}`;
  } catch (error) {
    console.warn(`Failed to download image from ${imageUrl}:`, error instanceof Error ? error.message : String(error));
    return null;
  }
}

// Main product safety checker flow
export const checkProductSafety = ai.defineFlow(
  {
    name: 'checkProductSafety',
    inputSchema: ProductInputSchema,
    outputSchema: SafetyCheckResultSchema,
  },

  async (product) => {
    console.log('Checking product safety:', product.name);

    // Step 1: Search recent RAPEX alerts
    const recentAlerts = await searchRecentRapexAlerts(7);

    if (recentAlerts.length === 0) {
      return {
        isSafe: true,
        warnings: [],
        recommendation: 'No recent RAPEX alerts found. Product appears safe based on available data.',
        checkedAt: new Date().toISOString(),
      };
    }

    // Step 2: Prepare comparison data
    const alertsText = recentAlerts.map(alert =>
      `Alert ID: ${alert.id}
Product: ${alert.fields.product_description}
Category: ${alert.fields.product_category}
Brand: ${alert.fields.product_brand || 'Unknown'}
Risk Level: ${alert.fields.risk_level}
Country: ${alert.fields.notifying_country}`
    ).join('\n\n');

    // Step 3: Create comparison prompt
    let comparisonPrompt = `You are a product safety expert analyzing potential matches between a new product and existing RAPEX alerts.

NEW PRODUCT TO CHECK:
Name: ${product.name}
Category: ${product.category}
Description: ${product.description}
Brand: ${product.brand || 'Not specified'}
Model: ${product.model || 'Not specified'}

RECENT RAPEX ALERTS (last 7 days):
${alertsText}

TASK:
1. Compare the new product with each RAPEX alert
2. Identify potential matches or similarities
3. For each potential match, provide:
   - Similarity score (0-100, where 100 is identical)
   - Reason for the match
   - Risk assessment

Return ONLY a JSON array of matches where similarity > 30. Each match should have:
- alertId: the RAPEX alert ID
- similarity: similarity score (30-100)
- reason: detailed explanation of why you think this is a match
- riskAssessment: assessment of the risk level

If no matches found, return empty array.`;

    // Step 4: Add image comparison if available
    let productImage = null;
    if (product.imageUrl) {
      productImage = await downloadImageAsBase64(product.imageUrl);
      if (productImage) {
        comparisonPrompt += `

PRODUCT IMAGE ANALYSIS:
The product has an associated image. Consider visual similarity when comparing with RAPEX alerts that might involve similar product types or appearances.`;
      }
    }

    // Step 5: Use Gemini to analyze similarities
    const analysisResponse = await ai.generate({
      model: googleAI.model('gemini-2.5-flash-lite'),
      prompt: comparisonPrompt,
      config: {
        temperature: 0.1, // Low temperature for consistent analysis
      },
    });

    console.log('Gemini analysis response:', analysisResponse.text);

    // Step 6: Parse the response
    let matches: any[] = [];
    try {
      const parsedResponse = JSON.parse(analysisResponse.text);
      matches = Array.isArray(parsedResponse) ? parsedResponse : [];
    } catch (error) {
      console.error('Failed to parse Gemini response:', error);
      // Fallback: try to extract JSON from response
      const jsonMatch = analysisResponse.text.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        try {
          matches = JSON.parse(jsonMatch[0]);
        } catch (fallbackError) {
          console.error('Fallback parsing also failed:', fallbackError);
          matches = [];
        }
      }
    }

    // Step 7: Build final result
    const warnings = matches.map((match: any) => {
      const alert = recentAlerts.find(a => a.id === match.alertId);
      const defaultAlert = {
        meta: { recordid: '', alert_date: '', ingested_at: '' },
        fields: { product_category: '', product_description: '', risk_level: '', notifying_country: '' },
      };
      const alertDetails = alert ? {
        meta: {
          recordid: String(alert.meta?.recordid || alert.id || ''),
          alert_date: String(alert.meta?.alert_date || ''),
          ingested_at: String(alert.meta?.ingested_at || ''),
          ...alert.meta,
        },
        fields: {
          product_category: String(alert.fields?.product_category || ''),
          product_description: String(alert.fields?.product_description || ''),
          risk_level: String(alert.fields?.risk_level || ''),
          notifying_country: String(alert.fields?.notifying_country || ''),
          ...(alert.fields || {}),
        },
      } : defaultAlert;

      return {
        alertId: match.alertId || '',
        similarity: match.similarity || 0,
        riskLevel: (alertDetails.fields as any)?.risk_level || 'unknown',
        reason: match.reason || 'Potential similarity detected',
        alertDetails,
      };
    }).filter((warning: any) => warning.similarity > 30);

    const isSafe = warnings.length === 0;

    let recommendation = '';
    if (isSafe) {
      recommendation = 'Product appears safe based on RAPEX database analysis. No significant matches found.';
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
