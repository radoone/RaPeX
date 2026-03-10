
import * as logger from "firebase-functions/logger";
import { onRequest } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import "./firebase-admin.js";
import { SCHEDULER_CONFIG } from "./safety-gate-config.js";
import { backfillLatestRapexEmbeddings } from "./safety-gate-backfill.js";
import { handleCheckProductSafetyRequest } from "./safety-gate-http.js";
import { runOpenDataSoftApiTest, runSafetyGateLoader } from "./safety-gate-loader.js";

function extractApiKey(req: { headers?: Record<string, unknown>; query?: Record<string, unknown>; body?: Record<string, unknown> }): string {
  const headerValue = req.headers?.["x-api-key"];
  if (typeof headerValue === "string" && headerValue.trim()) {
    return headerValue.trim();
  }

  const queryValue = req.query?.apiKey;
  if (typeof queryValue === "string" && queryValue.trim()) {
    return queryValue.trim();
  }

  const bodyValue = req.body?.apiKey;
  if (typeof bodyValue === "string" && bodyValue.trim()) {
    return bodyValue.trim();
  }

  return "";
}

// --- Scheduled Function ---
export const dailyRapexDeltaLoader = onSchedule(
  {
    ...SCHEDULER_CONFIG,
    secrets: ["GOOGLE_API_KEY"],
  },
  async (event) => {
    logger.info("Starting daily Safety Gate delta loader job.", { event });
    await runSafetyGateLoader();
  },
);

// --- OpenDataSoft API Test Endpoint ---
export const testOpenDataSoftAPI = onRequest(
  {
    region: "europe-west1",
    memory: "256MiB",
  },
  async (req, res) => {
    try {
      logger.info("Testing OpenDataSoft API connection", { method: req.method, query: req.query });
      const result = await runOpenDataSoftApiTest(req.query);
      logger.info("OpenDataSoft API test completed successfully", result);
      res.status(200).json(result);
    } catch (error) {
      logger.error("OpenDataSoft API test failed", { error });
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : String(error),
        api: {
          endpoint: "https://public.opendatasoft.com/api/records/1.0/search",
          dataset: "healthref-europe-rapex-en",
        },
        timestamp: new Date().toISOString(),
      });
    }
  },
);

// --- Manual HTTP Trigger for Testing ---
export const manualRapexLoader = onRequest(
  {
    region: "europe-west1",
    memory: "256MiB",
    secrets: ["GOOGLE_API_KEY"],
  },
  async (req, res) => {
    try {
      logger.info("Manual Safety Gate loader triggered via HTTP", { method: req.method, url: req.url });

      await runSafetyGateLoader();

      res.status(200).json({
        success: true,
        message: "Safety Gate loader completed successfully",
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error("Manual Safety Gate loader failed", { error });
      res.status(500).json({
        success: false,
        message: "Safety Gate loader failed",
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
      });
    }
  },
);

export const pilotRapexEmbeddingBackfill = onRequest(
  {
    region: "europe-west1",
    memory: "512MiB",
    timeoutSeconds: 540,
    secrets: ["GOOGLE_API_KEY", "SAFETY_GATE_API_KEY"],
  },
  async (req, res) => {
    const providedKey = extractApiKey(req as any);
    const expectedKey = (process.env.SAFETY_GATE_API_KEY ?? "").trim();

    if (!providedKey || !expectedKey || providedKey !== expectedKey) {
      logger.warn("Unauthorized RAPEX backfill access attempt", {
        hasApiKey: Boolean(providedKey),
      });
      res.status(401).json({
        error: "Unauthorized",
        message: "Valid API key required",
      });
      return;
    }

    const rawLimit = req.method === "POST" ? req.body?.limit : req.query.limit;
    const parsedLimit = Number(rawLimit);
    const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : 20;

    try {
      logger.info("Pilot RAPEX embedding backfill started", { limit });
      const result = await backfillLatestRapexEmbeddings(limit);
      logger.info("Pilot RAPEX embedding backfill completed", result);
      res.status(200).json({
        success: true,
        ...result,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error("Pilot RAPEX embedding backfill failed", { error });
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
      });
    }
  },
);

// --- Product Safety Checker API ---
export const checkProductSafetyAPI = onRequest(
  {
    region: "europe-west1",
    memory: "512MiB",
    timeoutSeconds: 120, // Longer timeout for AI processing
    invoker: "public", // Allow unauthenticated access at platform level; API key enforced in code
    secrets: ["GOOGLE_API_KEY", "SAFETY_GATE_API_KEY"],
  },
  handleCheckProductSafetyRequest,
);
