import test from "node:test";
import assert from "node:assert/strict";
import { canonicalGtin, extractGtins } from "../lib/gtin.js";

test("validates complete GTINs and normalizes equivalent representations", () => {
  assert.equal(canonicalGtin("4006381333931"), "04006381333931");
  assert.equal(canonicalGtin("04006381333931"), "04006381333931");
  assert.equal(canonicalGtin("036000291452"), "00036000291452");
  assert.equal(canonicalGtin("96385074"), "00000096385074");
  for (const invalid of ["4006381333932", "00000000", "123", "40063813339310", "4006 381333931", ""]) {
    assert.equal(canonicalGtin(invalid), null);
  }
});

test("extracts valid standalone codes without matching substrings or malformed codes", () => {
  assert.deepEqual(extractGtins("EAN 4006381333931; 04006381333931; invalid 4006381333932"), ["04006381333931"]);
  assert.deepEqual(extractGtins("123456789012345 4006381333931"), ["04006381333931"]);
});
