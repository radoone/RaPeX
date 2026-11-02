import { z } from "genkit";
import { functionsAi } from "./firebase-admin.js";

export const ProductInputSchema = functionsAi.defineSchema(
  "ProductInput",
  z.object({
    name: z.string().max(500).describe("Product name"),
    category: z.string().max(200).describe("Product category (toys, electronics, etc.)"),
    description: z.string().max(5000).describe("Product description"),
    imageUrl: z.string().max(2048).optional().describe("URL to product image"),
    imageUrls: z.array(z.string().max(2048)).max(10).optional().describe("URLs to product images"),
    brand: z.string().max(300).optional().describe("Product brand"),
    model: z.string().max(300).optional().describe("Product model"),
    barcodes: z.array(z.object({
      barcode: z.string().max(100),
      variantId: z.string().max(128).optional(),
      variantTitle: z.string().max(500).optional(),
    })).max(2048).optional(),
    barcodesComplete: z.boolean().optional(),
    shop: z.string().max(255).optional().describe("Shopify shop domain for merchant product cache reuse"),
    productId: z.string().max(128).optional().describe("Shopify product ID for merchant product cache reuse"),
    sourceUpdatedAt: z.string().max(64).optional().describe("Shopify source updated timestamp for cache validation"),
  }),
);

export type ProductInput = z.infer<typeof ProductInputSchema>;

export const RapexAlertSchema = functionsAi.defineSchema(
  "RapexAlert",
  z.object({
    meta: z.object({
      recordid: z.string(),
      alert_date: z.string(),
      ingested_at: z.string(),
    }),
    fields: z
      .object({
        // Official ec.europa.eu schema fields
        caseNumber: z.string().optional(),
        brand: z.string().optional(),
        name: z.string().optional(),
        product: z.string().optional(),
        type_numberOfModel: z.string().optional(),
        category: z.string().optional(),
        danger: z.string().optional(),
        measures: z.string().optional(),
        description: z.string().optional(),
        level: z.string().optional(),
        riskType: z.string().optional(),
        notifyingCountry: z.string().optional(),
        countryOfOrigin: z.string().optional(),
        url: z.string().optional(),

        // Legacy fields for backward compatibility
        alert_number: z.string().optional(),
        product_category: z.string().optional(),
        product_description: z.string().optional(),
        risk_level: z.string().optional(),
        alert_level: z.string().optional(),
        alert_type: z.string().optional(),
        risk_legal_provision: z.string().optional(),
        notifying_country: z.string().optional(),
        product_brand: z.string().optional(),
        product_model: z.string().optional(),
        product_image: z.string().optional(),
        product_other_images: z.string().optional(),
        pictures: z.array(z.string()).optional(),
      })
      .passthrough(),
  }),
);

export const MatchSchema = functionsAi.defineSchema(
  "SafetyGateMatch",
  z.object({
    alertId: z.string(),
    matchBasis: z.enum(["gtin", "similarity", "model_family"]).optional(),
    identityAssessment: z.enum(["identifier", "same_model", "distinctive_visual", "uncertain"]).optional(),
    identifierMatches: z.array(z.object({
      gtin: z.string(), barcode: z.string(), alertBarcode: z.string(),
      variantId: z.string().optional(), variantTitle: z.string().optional(),
    })).optional(),
    overallSimilarity: z.number(),
    imageSimilarity: z.number().optional(),
    textSimilarity: z.number().optional(),
    scoreBreakdown: z
      .object({
        visualWeight: z.number(),
        textWeight: z.number(),
        scoringMode: z.enum(["image-first", "text-only"]),
      })
      .optional(),
    riskLevel: z.string(),
    alertType: z.string(),
    riskLegalProvision: z.string(),
    reason: z.string(),
    alertDetails: RapexAlertSchema,
  }),
);

export type MatchResult = z.infer<typeof MatchSchema>;

// The model judges similarity; authoritative source/variant evidence is server-owned.
export const AnalysisMatchesSchema = functionsAi.defineSchema(
  "SafetyGateAnalysisMatches",
  z.array(z.object({
    alertId: z.string().min(1).max(150),
    overallSimilarity: z.number().min(0).max(100),
    textSimilarity: z.number().min(0).max(100),
    imageSimilarity: z.number().min(0).max(100).optional(),
    identityAssessment: z.enum(["same_model", "distinctive_visual", "uncertain"]),
    reason: z.string().min(1).max(1500),
  })).max(12),
);

export const SafetyCheckResultSchema = functionsAi.defineSchema(
  "SafetyCheckResult",
  z.object({
    isSafe: z.boolean(),
    warnings: z.array(MatchSchema),
    recommendation: z.string(),
    checkedAt: z.string(),
    analysis: z.object({
      mode: z.enum(["text-only", "with-image"]),
      scoringMode: z.enum(["image-first", "text-only"]),
      productImagesProvided: z.number(),
      productImagesUsed: z.number(),
      alertImagesUsed: z.number(),
      candidateAlertsConsidered: z.number(),
      comparedImageAlertIds: z.array(z.string()).optional(),
    }),
  }),
);

export const EncodedImageSchema = functionsAi.defineSchema(
  "EncodedImage",
  z.object({
    url: z.string(),
    contentType: z.string().optional(),
  }),
);

export const AnalysisPromptInputSchema = functionsAi.defineSchema(
  "AnalysisPromptInput",
  z.object({
    comparisonPrompt: z.string(),
    productImages: z.array(EncodedImageSchema),
    alertImages: z.array(
      z.object({
        alertId: z.string(),
        media: EncodedImageSchema,
      }),
    ),
  }),
);

export type AnalysisPromptInput = z.infer<typeof AnalysisPromptInputSchema>;
export type SafetyCheckResult = z.infer<typeof SafetyCheckResultSchema>;
