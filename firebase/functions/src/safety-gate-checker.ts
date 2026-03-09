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
import {
  getProductImageUrls,
  isUnsupportedMimeError,
  limitImageUrls,
  normalizePictures,
  prepareImageMedia,
} from "./safety-gate-checker-media.js";
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
import type { EncodedImage, NormalizedAlert, SafetyCheckAnalysis } from "./safety-gate-checker.types.js";

const productMatchAnalysisPrompt = functionsAi.prompt<
  typeof AnalysisPromptInputSchema,
  typeof SafetyCheckResultSchema
>("productMatchAnalysis");

function appendMediaMessages(
  messages: Array<{ role: "model" | "user" | "system" | "tool"; content: Part[] }>,
  input: AnalysisPromptInput,
): Array<{ role: "model" | "user" | "system" | "tool"; content: Part[] }> {
  if (input.productImages.length === 0 && input.alertImages.length === 0) {
    return messages;
  }

  const mediaContent: Part[] = [];

  if (input.productImages.length > 0) {
    mediaContent.push({ text: "Product reference images:" });
    input.productImages.forEach((image, index) => {
      mediaContent.push({ text: `Product image ${index + 1}:` });
      mediaContent.push({ media: image });
    });
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
): Promise<
  AnalysisPromptInput & {
    analysis: Omit<SafetyCheckAnalysis, "mode" | "candidateAlertsConsidered" | "scoringMode">;
  }
> {
  const productImageUrls = getProductImageUrls(product);
  const productImages: EncodedImage[] = [];
  for (const imageUrl of productImageUrls) {
    const encoded = await prepareImageMedia(imageUrl);
    if (encoded) {
      productImages.push(encoded);
    }
  }

  const alertImages: Array<{ alertId: string; media: EncodedImage }> = [];
  for (const alert of alerts) {
    const pictures = limitImageUrls(normalizePictures(alert.fields), 2);
    for (const picture of pictures) {
      const encoded = await prepareImageMedia(picture);
      if (encoded) {
        alertImages.push({ alertId: alert.id, media: encoded });
      }

      if (alertImages.length >= 8) {
        break;
      }
    }

    if (alertImages.length >= 8) {
      break;
    }
  }

  return {
    comparisonPrompt: "",
    productImages,
    alertImages,
    analysis: {
      productImagesProvided: productImageUrls.length,
      productImagesUsed: productImages.length,
      alertImagesUsed: alertImages.length,
    },
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
        ? { ...promptInput, productImages: [], alertImages: [] }
        : promptInput;
    const analysis: SafetyCheckAnalysis = {
      mode: attempt.promptType === "text" ? "text-only" : "with-image",
      scoringMode: attempt.promptType === "text" ? "text-only" : "image-first",
      productImagesProvided: promptInput.analysis.productImagesProvided,
      productImagesUsed: input.productImages.length,
      alertImagesUsed: input.alertImages.length,
      candidateAlertsConsidered: alerts.length,
    };

    try {
      if (attempt.promptType === "text") {
        const response = await productMatchAnalysisPrompt(input, {
          model: googleAI.model(attempt.model),
        });
        return { response, analysis };
      }

      const renderedPrompt = await productMatchAnalysisPrompt.render(input, {
        model: googleAI.model(attempt.model),
      });
      const response = await functionsAi.generate({
        ...renderedPrompt,
        messages: appendMediaMessages(renderedPrompt.messages ?? [], input),
        model: googleAI.model(attempt.model),
      });
      return { response, analysis };
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
    const productImageCount = getProductImageUrls(product).length;

    const ragAlerts = await retrieveAlertsWithRag(product);
    const candidateAlerts =
      ragAlerts.length > 0 ? ragAlerts : await searchRecentRapexAlerts(ALERT_LOOKBACK_DAYS);

    if (candidateAlerts.length === 0) {
      return createNoAlertsResult(productImageCount);
    }

    const comparisonPrompt = buildComparisonPrompt(product, candidateAlerts);
    const analysisResult = await analyzeProductMatches(product, candidateAlerts, comparisonPrompt);

    if (!analysisResult) {
      return createUnavailableAnalysisResult({
        mode: "text-only",
        scoringMode: "text-only",
        productImagesProvided: productImageCount,
        productImagesUsed: 0,
        alertImagesUsed: 0,
        candidateAlertsConsidered: candidateAlerts.length,
      });
    }

    console.log("Gemini analysis response:", analysisResult.response.text);
    console.log("Safety check analysis mode:", analysisResult.analysis);
    const matches = parseAnalysisMatches(analysisResult.response);
    return buildSafetyCheckResult(matches, candidateAlerts, analysisResult.analysis);
  },
);

console.log("Product safety checker flow defined successfully!");
