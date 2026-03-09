
import * as logger from "firebase-functions/logger";
import { onRequest } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import "./firebase-admin.js";
import { SCHEDULER_CONFIG } from "./safety-gate-config.js";
import { handleCheckProductSafetyRequest } from "./safety-gate-http.js";
import { runOpenDataSoftApiTest, runSafetyGateLoader } from "./safety-gate-loader.js";

// --- Scheduled Function ---
export const dailyRapexDeltaLoader = onSchedule(
  SCHEDULER_CONFIG,
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
