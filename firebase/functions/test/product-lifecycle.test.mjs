import test from "node:test";
import assert from "node:assert/strict";
import { isProductChangeSupersededByDeletion } from "../lib/product-lifecycle.js";

test("delayed update webhooks cannot resurrect a deleted product", () => {
  assert.equal(isProductChangeSupersededByDeletion(
    { seconds: 1 }, "2026-09-30T10:00:00.000Z", "2026-09-30T09:59:59.000Z",
  ), true);
  assert.equal(isProductChangeSupersededByDeletion(
    { seconds: 1 }, "2026-09-30T10:00:00.000Z", "2026-09-30T10:00:00.000Z",
  ), true);
});

test("a genuinely newer product version can be reactivated after deletion", () => {
  assert.equal(isProductChangeSupersededByDeletion(
    { seconds: 1 }, "2026-09-30T10:00:00.000Z", "2026-09-30T10:00:01.000Z",
  ), false);
});

test("legacy deletion markers without a timestamp do not block later updates", () => {
  assert.equal(isProductChangeSupersededByDeletion({ seconds: 1 }, null, "2026-09-30T10:00:01.000Z"), false);
});
