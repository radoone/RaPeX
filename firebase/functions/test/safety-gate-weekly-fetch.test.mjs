import assert from "node:assert/strict";
import test from "node:test";
import { fetchSafetyGateXmlWithRetry } from "../lib/safety-gate-weekly-loader.js";

test("fetchSafetyGateXmlWithRetry uses 60s default timeout and succeeds on first try", async () => {
  const calls = [];
  const xml = await fetchSafetyGateXmlWithRetry("https://ec.europa.eu/test.xml", {
    fetcher: async (url, timeoutMs) => {
      calls.push({ url, timeoutMs });
      return "<xml>ok</xml>";
    },
    sleep: async () => {
      throw new Error("sleep should not be called on first-attempt success");
    },
  });
  assert.equal(xml, "<xml>ok</xml>");
  assert.deepEqual(calls, [{ url: "https://ec.europa.eu/test.xml", timeoutMs: 60_000 }]);
});

test("fetchSafetyGateXmlWithRetry retries transient ECONNABORTED timeout with exponential backoff", async () => {
  let attempts = 0;
  const delays = [];
  const xml = await fetchSafetyGateXmlWithRetry("https://ec.europa.eu/test.xml", {
    maxAttempts: 3,
    baseDelayMs: 500,
    fetcher: async () => {
      attempts++;
      if (attempts < 3) {
        const err = new Error("timeout of 60000ms exceeded");
        err.code = "ECONNABORTED";
        throw err;
      }
      return "<xml>recovered</xml>";
    },
    sleep: async (ms) => {
      delays.push(ms);
    },
  });
  assert.equal(xml, "<xml>recovered</xml>");
  assert.equal(attempts, 3);
  assert.deepEqual(delays, [500, 1000]);
});

test("fetchSafetyGateXmlWithRetry retries HTTP 503 and throws after exhausting attempts", async () => {
  let attempts = 0;
  const delays = [];
  await assert.rejects(
    () =>
      fetchSafetyGateXmlWithRetry("https://ec.europa.eu/test.xml", {
        maxAttempts: 2,
        baseDelayMs: 250,
        fetcher: async () => {
          attempts++;
          const err = new Error("Service Unavailable");
          err.response = { status: 503 };
          throw err;
        },
        sleep: async (ms) => {
          delays.push(ms);
        },
      }),
    /Service Unavailable/,
  );
  assert.equal(attempts, 2);
  assert.deepEqual(delays, [250]);
});

test("fetchSafetyGateXmlWithRetry does not retry non-retryable HTTP 404", async () => {
  let attempts = 0;
  await assert.rejects(
    () =>
      fetchSafetyGateXmlWithRetry("https://ec.europa.eu/test.xml", {
        maxAttempts: 3,
        fetcher: async () => {
          attempts++;
          const err = new Error("Not Found");
          err.response = { status: 404 };
          throw err;
        },
        sleep: async () => {
          throw new Error("sleep should not be called on 404");
        },
      }),
    /Not Found/,
  );
  assert.equal(attempts, 1);
});
