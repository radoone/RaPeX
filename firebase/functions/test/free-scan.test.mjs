import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

const { freeScanTestUtils, sendFreeScanReport } = await import("../lib/free-scan.js");

test("report submission retries accept only provider-confirmed idempotency duplicates", async () => {
  const originalFetch = global.fetch;
  const originalKey = process.env.BREVO_API_KEY;
  const originalSender = process.env.BREVO_SENDER_EMAIL;
  process.env.BREVO_API_KEY = "unit-test-placeholder";
  process.env.BREVO_SENDER_EMAIL = "info@example.com";
  const data = { locale: "en", domain: "example.myshopify.com", email: "merchant@example.com" };
  const result = { success: true, lead: { totalProductsScanned: 2, flaggedProductsCount: 0, matches: [] } };
  try {
    global.fetch = async (_url, options) => {
      assert.match(JSON.parse(options.body).headers.idempotencyKey, /^[a-f0-9-]{36}$/);
      assert.ok(options.signal);
      return { ok: false, status: 400, json: async () => ({ code: "duplicate_parameter", message: "idempotency key already used" }) };
    };
    await sendFreeScanReport("test-request", data, result);
    global.fetch = async () => ({ ok: false, status: 400, json: async () => ({ code: "duplicate_parameter", message: "recipient invalid" }) });
    await assert.rejects(sendFreeScanReport("test-request", data, result), /rejected/);
    global.fetch = async () => ({ ok: true, status: 201, json: async () => ({}) });
    await assert.rejects(sendFreeScanReport("test-request", data, result), /acceptance/);
  } finally {
    global.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.BREVO_API_KEY; else process.env.BREVO_API_KEY = originalKey;
    if (originalSender === undefined) delete process.env.BREVO_SENDER_EMAIL; else process.env.BREVO_SENDER_EMAIL = originalSender;
  }
});

test("public scan accepts only a Shopify-hosted catalog domain", () => {
  assert.equal(freeScanTestUtils.normalizedDomain(" HTTPS://Example-Store.myshopify.com/ "), "example-store.myshopify.com");
  for (const input of [
    "localhost",
    "127.0.0.1",
    "example.myshopify.com.evil.test",
    "example.myshopify.com/path",
    "example.myshopify.com:443",
    "https://example.myshopify.com@evil.test",
  ]) {
    assert.equal(freeScanTestUtils.normalizedDomain(input), null, input);
  }
});

test("public scan rejects invalid recipient addresses", () => {
  assert.equal(freeScanTestUtils.normalizedEmail(" Merchant@Example.COM "), "merchant@example.com");
  assert.equal(freeScanTestUtils.normalizedEmail("merchant@example.com,other@example.com"), null);
  assert.equal(freeScanTestUtils.normalizedEmail("invalid"), null);
});

test("confirmation tokens are one request ID plus an unguessable secret", () => {
  const id = "Abcdef12345678901234";
  const secret = "A".repeat(43);
  assert.deepEqual(freeScanTestUtils.parseConfirmationToken(`${id}.${secret}`), { requestId: id, secret });
  assert.equal(freeScanTestUtils.parseConfirmationToken(`${id}.short`), null);
  const digest = createHash("sha256").update(secret).digest("hex");
  assert.equal(freeScanTestUtils.tokenMatches(secret, digest), true);
  assert.equal(freeScanTestUtils.tokenMatches("B".repeat(43), digest), false);
});

test("Turnstile checks hostname and action and rejects test credentials outside emulator", async () => {
  const originalFetch = global.fetch;
  const originalSecret = process.env.TURNSTILE_SECRET_KEY;
  const originalEmulator = process.env.FUNCTIONS_EMULATOR;
  global.fetch = async () => ({ ok: true, json: async () => ({ success: true, hostname: "127.0.0.1", action: "free_scan" }) });
  process.env.TURNSTILE_SECRET_KEY = "1x0000000000000000000000000000000AA";
  process.env.FUNCTIONS_EMULATOR = "true";
  try {
    assert.equal(await freeScanTestUtils.verifyTurnstile("dummy-token"), true);
    global.fetch = async () => ({ ok: true, json: async () => ({ success: true, hostname: "evil.example", action: "free_scan" }) });
    assert.equal(await freeScanTestUtils.verifyTurnstile("dummy-token"), false);
    global.fetch = async () => ({ ok: true, json: async () => ({ success: true, hostname: "127.0.0.1", action: "login" }) });
    assert.equal(await freeScanTestUtils.verifyTurnstile("dummy-token"), false);
    delete process.env.FUNCTIONS_EMULATOR;
    assert.equal(await freeScanTestUtils.verifyTurnstile("dummy-token"), false);
  } finally {
    global.fetch = originalFetch;
    if (originalSecret === undefined) delete process.env.TURNSTILE_SECRET_KEY;
    else process.env.TURNSTILE_SECRET_KEY = originalSecret;
    if (originalEmulator === undefined) delete process.env.FUNCTIONS_EMULATOR;
    else process.env.FUNCTIONS_EMULATOR = originalEmulator;
  }
});

test("store preflight requires a nonempty public JSON product catalog", async () => {
  const originalFetch = global.fetch;
  try {
    global.fetch = async () => ({
      ok: true,
      headers: { get: () => "application/json" },
      json: async () => ({ products: [{ id: 123 }] }),
    });
    assert.equal(await freeScanTestUtils.preflightStore("example.myshopify.com"), true);
    global.fetch = async () => ({
      ok: true,
      headers: { get: () => "text/html" },
      json: async () => ({ products: [{ id: 123 }] }),
    });
    assert.equal(await freeScanTestUtils.preflightStore("example.myshopify.com"), false);
  } finally {
    global.fetch = originalFetch;
  }
});
