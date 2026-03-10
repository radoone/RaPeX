
import * as logger from "firebase-functions/logger";
import { onRequest } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import "./firebase-admin.js";
import { SCHEDULER_CONFIG } from "./safety-gate-config.js";
import {
  handleRunMerchantDeltaMonitoringRequest,
  handleUpsertMerchantProductRequest,
  runDailyMerchantDeltaMonitoring,
} from "./merchant-monitoring.js";
import { handleCheckProductSafetyRequest } from "./safety-gate-http.js";
import { runSafetyGateLoader } from "./safety-gate-loader.js";

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

export const upsertMerchantProductAPI = onRequest(
  {
    region: "europe-west1",
    memory: "512MiB",
    secrets: ["GOOGLE_API_KEY", "SAFETY_GATE_API_KEY"],
  },
  handleUpsertMerchantProductRequest,
);

export const runMerchantDeltaMonitoringAPI = onRequest(
  {
    region: "europe-west1",
    memory: "1GiB",
    timeoutSeconds: 540,
    secrets: ["GOOGLE_API_KEY", "SAFETY_GATE_API_KEY"],
  },
  handleRunMerchantDeltaMonitoringRequest,
);

export const dailyMerchantDeltaMonitoring = onSchedule(
  {
    ...SCHEDULER_CONFIG,
    schedule: "47 3 * * *",
    secrets: ["GOOGLE_API_KEY", "SAFETY_GATE_API_KEY"],
  },
  async (event) => {
    logger.info("Starting daily merchant delta monitoring job.", { event });
    const result = await runDailyMerchantDeltaMonitoring();
    logger.info("Daily merchant delta monitoring completed.", result);
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
