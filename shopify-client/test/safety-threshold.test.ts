import { expect, it, vi } from "vitest";
vi.mock("../app/merchant-db.server", () => ({ default: {} }));
import { applySimilarityThreshold, type SafetyCheckResult } from "../app/services/safety-gate-checker.server";

it("keeps identifier hits and unresolved identity warnings even above the similarity threshold", () => {
  const warning = { alertId: "x", overallSimilarity: 70, riskLevel: "high", alertType: "risk", riskLegalProvision: "", reason: "Review identity", alertDetails: { meta: { recordid: "x", alert_date: "", ingested_at: "" }, fields: { product_category: "", product_description: "", risk_level: "", alert_level: "", alert_type: "", risk_legal_provision: "", notifying_country: "" } } };
  const result: SafetyCheckResult = { isSafe: false, warnings: [
    { ...warning, alertId: "exact", matchBasis: "gtin", identityAssessment: "identifier" },
    { ...warning, alertId: "family", matchBasis: "model_family", identityAssessment: "uncertain" },
    { ...warning, alertId: "visual", identityAssessment: "distinctive_visual" },
  ], checkedAt: "", recommendation: "", analysis: { mode: "text-only", scoringMode: "text-only", productImagesProvided: 0, productImagesUsed: 0, alertImagesUsed: 0, candidateAlertsConsidered: 3 } };
  const filtered = applySimilarityThreshold(result, 95);
  expect(filtered.warnings.map(w => w.alertId)).toEqual(["exact", "family"]);
  expect(filtered.isSafe).toBe(false);
});
