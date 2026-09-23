import assert from "node:assert/strict";
import test from "node:test";

const { handleScanPublicShopifyStoreRequest } = await import("../lib/public-store-scanner.js");

function mockResponse() {
  return {
    statusCode: 200,
    payload: undefined,
    set() {},
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; },
    send(payload) { this.payload = payload; },
  };
}

test("public store scanner fails closed when its API key is missing or invalid", async () => {
  const oldKey = process.env.SAFETY_GATE_API_KEY;
  try {
    process.env.SAFETY_GATE_API_KEY = "configured-test-key";
    const request = { method: "POST", body: { domain: "example.myshopify.com" }, headers: {}, query: {} };
    const missingKeyResponse = mockResponse();
    await handleScanPublicShopifyStoreRequest(request, missingKeyResponse);
    assert.equal(missingKeyResponse.statusCode, 401);

    const invalidKeyResponse = mockResponse();
    await handleScanPublicShopifyStoreRequest(
      { ...request, headers: { "x-api-key": "wrong-key" } },
      invalidKeyResponse,
    );
    assert.equal(invalidKeyResponse.statusCode, 401);

    delete process.env.SAFETY_GATE_API_KEY;
    const missingConfigurationResponse = mockResponse();
    await handleScanPublicShopifyStoreRequest(request, missingConfigurationResponse);
    assert.equal(missingConfigurationResponse.statusCode, 401);
  } finally {
    if (oldKey === undefined) delete process.env.SAFETY_GATE_API_KEY;
    else process.env.SAFETY_GATE_API_KEY = oldKey;
  }
});
