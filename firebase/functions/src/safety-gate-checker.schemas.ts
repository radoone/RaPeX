import { z } from "genkit";
import { functionsAi } from "./firebase-admin.js";

export const ProductInputSchema = functionsAi.defineSchema(
  "ProductInput",
  z.object({
    name: z.string().describe("Product name"),
    category: z.string().describe("Product category (toys, electronics, etc.)"),
    description: z.string().describe("Product description"),
    imageUrl: z.string().optional().describe("URL to product image"),
    imageUrls: z.array(z.string()).optional().describe("URLs to product images"),
    brand: z.string().optional().describe("Product brand"),
    model: z.string().optional().describe("Product model"),
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
  }),
);

export const MatchSchema = functionsAi.defineSchema(
  "SafetyGateMatch",
  z.object({
    alertId: z.string(),
    similarity: z.number(),
    riskLevel: z.string(),
    alertType: z.string(),
    riskLegalProvision: z.string(),
    reason: z.string(),
    alertDetails: RapexAlertSchema,
  }),
);

export type MatchResult = z.infer<typeof MatchSchema>;

export const SafetyCheckResultSchema = functionsAi.defineSchema(
  "SafetyCheckResult",
  z.object({
    isSafe: z.boolean(),
    warnings: z.array(MatchSchema),
    recommendation: z.string(),
    checkedAt: z.string(),
    analysis: z.object({
      mode: z.enum(["text-only", "with-image"]),
      productImagesProvided: z.number(),
      productImagesUsed: z.number(),
      alertImagesUsed: z.number(),
      candidateAlertsConsidered: z.number(),
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
