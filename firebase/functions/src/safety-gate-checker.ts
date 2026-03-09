import { googleAI } from "@genkit-ai/google-genai";
import { type Part } from "genkit";
import { functionsAi } from "./firebase-admin.js";
import {
  AnalysisPromptInputSchema,
  ProductInputSchema,
  type AnalysisPromptInput,
  type ProductInput,
  SafetyCheckResultSchema,
} from "./safety-gate-checker.schemas.js";
import { isUnsupportedMimeError, prepareImageMedia } from "./safety-gate-checker-media.js";
import {
  ALERT_LOOKBACK_DAYS,
  retrieveAlertsWithRag,
  searchRecentRapexAlerts,
} from "./safety-gate-checker-retrieval.js";
import {
  buildComparisonPrompt,
  buildSafetyCheckResult,
  createNoAlertsResult,
  createUnavailableAnalysisResult,
  parseAnalysisMatches,
} from "./safety-gate-checker-results.js";
import type { EncodedImage, NormalizedAlert } from "./safety-gate-checker.types.js";

const productMatchAnalysisPrompt = functionsAi.prompt<
  typeof AnalysisPromptInputSchema,
  typeof SafetyCheckResultSchema
>("productMatchAnalysis");

function appendMediaMessages(
  messages: Array<{ role: "model" | "user" | "system" | "tool"; content: Part[] }>,
  input: AnalysisPromptInput,
): Array<{ role: "model" | "user" | "system" | "tool"; content: Part[] }> {
  if (!input.productImage && input.alertImages.length === 0) {
    return messages;
  }

  const mediaContent: Part[] = [];

  if (input.productImage) {
    mediaContent.push({ text: "Product reference image:" });
    mediaContent.push({ media: input.productImage });
  }

  if (input.alertImages.length > 0) {
    mediaContent.push({
      text: "Reference Safety Gate alert images (match them to the alert IDs above):",
    });
    for (const image of input.alertImages) {
      mediaContent.push({ text: `Alert ${image.alertId} image:` });
      mediaContent.push({ media: image.media });
    }
  }

  return [
    ...messages,
    {
      role: "user" as const,
      content: mediaContent,
    },
  ];
}

async function buildPromptParts(
  product: ProductInput,
  alerts: NormalizedAlert[],
): Promise<AnalysisPromptInput> {
  const productImage = product.imageUrl ? await prepareImageMedia(product.imageUrl) : null;

  const alertImages: Array<{ alertId: string; media: EncodedImage }> = [];
  for (const alert of alerts) {
    const pictures = Array.isArray(alert.fields?.pictures) ? alert.fields.pictures : [];
    const firstPicture = pictures.find((picture) => typeof picture === "string" && picture.trim());
    if (!firstPicture) {
      continue;
    }

    const encoded = await prepareImageMedia(firstPicture);
    if (encoded) {
      alertImages.push({ alertId: alert.id, media: encoded });
    }

    if (alertImages.length >= 2) {
      break;
    }
  }

  return {
    comparisonPrompt: "",
    productImage,
    alertImages,
  };
}

async function analyzeProductMatches(product: ProductInput, alerts: NormalizedAlert[], comparisonPrompt: string) {
  const promptInput = await buildPromptParts(product, alerts);
  promptInput.comparisonPrompt = comparisonPrompt;
  const attempts = [
    { model: "gemini-2.5-flash-lite", promptType: "multimodal", label: "2.5-lite multimodal" },
    { model: "gemini-2.5-flash-lite", promptType: "text", label: "2.5-lite text-only" },
    { model: "gemini-1.5-flash-002", promptType: "multimodal", label: "1.5 multimodal" },
    { model: "gemini-1.5-flash-002", promptType: "text", label: "1.5 text-only" },
  ] as const;

  for (const attempt of attempts) {
    const input =
      attempt.promptType === "text"
        ? { ...promptInput, productImage: null, alertImages: [] }
        : promptInput;

    try {
      if (attempt.promptType === "text") {
        return await productMatchAnalysisPrompt(input, {
          model: googleAI.model(attempt.model),
        });
      }

      const renderedPrompt = await productMatchAnalysisPrompt.render(input, {
        model: googleAI.model(attempt.model),
      });
      return await functionsAi.generate({
        ...renderedPrompt,
        messages: appendMediaMessages(renderedPrompt.messages ?? [], input),
        model: googleAI.model(attempt.model),
      });
    } catch (error) {
      const mimeIssue = isUnsupportedMimeError(error);
      console.error(
        `Analysis attempt failed (${attempt.label})${mimeIssue ? " [unsupported mime]" : ""}; trying next`,
        error,
      );
    }
  }

  return null;
}

export const checkProductSafety = functionsAi.defineFlow(
  {
    name: "checkProductSafety",
    inputSchema: ProductInputSchema,
    outputSchema: SafetyCheckResultSchema,
  },
  async (product) => {
    console.log("Checking product safety:", product.name);

    const ragAlerts = await retrieveAlertsWithRag(product);
    const candidateAlerts =
      ragAlerts.length > 0 ? ragAlerts : await searchRecentRapexAlerts(ALERT_LOOKBACK_DAYS);

    if (candidateAlerts.length === 0) {
      return createNoAlertsResult();
    }

    const comparisonPrompt = buildComparisonPrompt(product, candidateAlerts);
    const analysisResponse = await analyzeProductMatches(product, candidateAlerts, comparisonPrompt);

    if (!analysisResponse) {
      return createUnavailableAnalysisResult();
    }

    console.log("Gemini analysis response:", analysisResponse.text);
    const matches = parseAnalysisMatches(analysisResponse);
    return buildSafetyCheckResult(matches, candidateAlerts);
  },
);

console.log("Product safety checker flow defined successfully!");
