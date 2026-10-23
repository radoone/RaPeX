import assert from "node:assert/strict";
import test from "node:test";
import { compactScanPreview } from "../lib/free-scan-catalog.js";

test("durable scan previews retain bounded source evidence for the report", () => {
  const match = { productId: "1", productTitle: "Toy", productUrl: "https://example.myshopify.com/products/toy", result: { warnings: [{
    alertId: "internal-id", overallSimilarity: 92, reason: "x".repeat(5000),
    alertDetails: { fields: { url: "https://ec.europa.eu/record", caseNumber: "A12/EXAMPLE/26", type_numberOfModel: "Model 1", unrelated: "not-for-the-report", object: { private: true } } },
  }] } };
  const preview = compactScanPreview(Array(8).fill(match));
  assert.equal(preview.length, 5);
  const warning = preview[0].result.warnings[0];
  assert.equal(warning.reason.length, 1200);
  assert.equal(warning.alertDetails.fields.url, "https://ec.europa.eu/record");
  assert.equal(warning.alertDetails.fields.caseNumber, "A12/EXAMPLE/26");
  assert.equal(warning.alertDetails.fields.type_numberOfModel, "Model 1");
  assert.equal(warning.alertDetails.fields.unrelated, undefined);
  assert.equal(warning.alertDetails.fields.object, undefined);
  assert.equal(warning.overallSimilarity, 92);
});
