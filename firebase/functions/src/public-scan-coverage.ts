import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { URL } from "node:url";
import type { ProductInput } from "./safety-gate-checker.schemas.js";
import { productSafetyFingerprint } from "./product-safety-coverage.js";
import { AI_CONFIG, MATCHING_THRESHOLDS, SAFETY_GATE_CONFIG, MATCHER_POLICY_VERSION, RAG_CANDIDATE_LIMITS } from "./safety-gate-config.js";

// Bump when the matching prompt, evidence handling or retrieval contract changes.
export const PUBLIC_SCAN_COVERAGE_POLICY = createHash("sha256").update(JSON.stringify({
  version: 1, retrieval: "merchant-cached-vectors-12-text-6-image",
  thresholds: MATCHING_THRESHOLDS, candidateLimits: RAG_CANDIDATE_LIMITS, matcherPolicy: MATCHER_POLICY_VERSION,
  model: AI_CONFIG.primaryModel, fallback: AI_CONFIG.fallbackModel,
  textEmbedder: SAFETY_GATE_CONFIG.textEmbedder, imageEmbedder: SAFETY_GATE_CONFIG.imageEmbedder,
  prompt: createHash("sha256").update(readFileSync(new URL("../prompts/productMatchAnalysis.prompt", import.meta.url))).digest("hex"),
})).digest("hex");

export function publicScanCoverageFingerprint(product: ProductInput): string {
  return productSafetyFingerprint(product);
}
