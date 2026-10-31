
import * as logger from "firebase-functions/logger";
import { onRequest } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { onTaskDispatched } from "firebase-functions/v2/tasks";
import { onDocumentCreated, onDocumentUpdated } from "firebase-functions/v2/firestore";
import "./firebase-admin.js";
import { SCHEDULER_CONFIG } from "./safety-gate-config.js";
import {
  handleRunMerchantDeltaMonitoringRequest,
  handleMerchantMonitoringTask,
  handleUpsertMerchantProductRequest,
  handleStartShopifyProductChangeRequest,
  handleShopifyProductChangeTask,
  runDailyMerchantDeltaMonitoring,
} from "./merchant-monitoring.js";
import { handleCheckProductSafetyRequest } from "./safety-gate-http.js";
import { handleScanPublicShopifyStoreRequest } from "./public-store-scanner.js";
import { handleFreeScanRequest, processFreeScanRequest } from "./free-scan.js";
import { handleFreeScanCatalogTask } from "./free-scan-worker.js";
import { handleFreeScanOwnerCreated } from "./free-scan-owner-notification.js";
import {
  handleBrevoWebhook,
  handleImmediateAlertCreated,
  runWeeklyClearSummaries,
} from "./email-notifications.js";
import {
  backfillRecentAlertEmbeddings,
  runHistoricalSafetyGateBackfill,
  runSafetyGateLoader,
} from "./safety-gate-loader.js";
import { runSafetyGateWeeklyLoaderJob } from "./safety-gate-weekly-loader.js";
import {
  handleMerchantCatalogAuditTask,
  handleStartMerchantCatalogAuditRequest,
} from "./merchant-catalog-audit.js";
import { requireOperationsKey } from "./api-auth.js";

// --- Scheduled Function ---
export const dailyRapexDeltaLoader = onSchedule(
  {
    ...SCHEDULER_CONFIG,
    timeoutSeconds: 540,
    memory: "1GiB",
    secrets: ["GOOGLE_API_KEY"],
  },
  async (event) => {
    logger.info("Starting Safety Gate weekly XML loader job from ec.europa.eu", { event });
    const loaderResult = await runSafetyGateWeeklyLoaderJob();
    if (loaderResult.newAlertsCreated + loaderResult.alertsUpdated > 0) {
      logger.info("Safety Gate alerts were imported; enqueueing merchant delta checks immediately", {
        newAlertsCreated: loaderResult.newAlertsCreated,
        alertsUpdated: loaderResult.alertsUpdated,
      });
      await runDailyMerchantDeltaMonitoring(event.scheduleTime);
    }
  },
);

// --- Manual Weekly XML Loader HTTP Trigger ---
export const manualSafetyGateWeeklyLoader = onRequest(
  {
    region: "europe-west1",
    memory: "1GiB",
    maxInstances: 1,
    timeoutSeconds: 540,
    secrets: ["GOOGLE_API_KEY", "SAFETY_GATE_API_KEY"],
  },
  async (req, res) => {
    if (!requireOperationsKey(req, res, { allowAdminKey: true })) return;
    try {
      const year = req.query.year ? Number.parseInt(String(req.query.year), 10) : undefined;
      const weeks = req.query.weeks
        ? String(req.query.weeks)
            .split(",")
            .map((w) => Number.parseInt(w.trim(), 10))
            .filter(Boolean)
        : undefined;
      const forceSyncAll = req.query.forceSyncAll === "true";

      const result = await runSafetyGateWeeklyLoaderJob({
        year,
        weeks,
        forceSyncAllReports: forceSyncAll,
      });

      res.status(200).json({
        success: true,
        ...result,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error("Safety Gate weekly loader failed", { error });
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },
);

// --- Manual HTTP Trigger for Testing ---
export const manualRapexLoader = onRequest(
  {
    region: "europe-west1",
    memory: "256MiB",
    maxInstances: 1,
    secrets: ["GOOGLE_API_KEY", "SAFETY_GATE_API_KEY"],
  },
  async (req, res) => {
    if (!requireOperationsKey(req, res, { allowAdminKey: true })) return;
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

export const backfillRecentRapexEmbeddings = onRequest(
  {
    region: "europe-west1",
    memory: "1GiB",
    maxInstances: 1,
    timeoutSeconds: 540,
    secrets: ["GOOGLE_API_KEY", "SAFETY_GATE_API_KEY"],
  },
  async (req, res) => {
    if (!requireOperationsKey(req, res, { allowAdminKey: true })) return;
    try {
      const days = Number.parseInt(String(req.query.days || ""), 10);
      const limit = Number.parseInt(String(req.query.limit || ""), 10);
      const force = req.query.force === "true" || req.query.force === "1";
      logger.info("Manual recent Safety Gate embedding backfill triggered via HTTP", {
        method: req.method,
        url: req.url,
        days: Number.isFinite(days) ? days : undefined,
        limit: Number.isFinite(limit) ? limit : undefined,
        force,
      });

      const result = await backfillRecentAlertEmbeddings({
        days: Number.isFinite(days) ? days : undefined,
        limit: Number.isFinite(limit) ? limit : undefined,
        force,
      });

      res.status(200).json({
        success: true,
        ...result,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error("Manual recent Safety Gate embedding backfill failed", { error });
      res.status(500).json({
        success: false,
        message: "Recent Safety Gate embedding backfill failed",
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
      });
    }
  },
);

export const backfillHistoricalRapexAlerts = onRequest(
  {
    region: "europe-west1",
    memory: "1GiB",
    maxInstances: 1,
    timeoutSeconds: 540,
    secrets: ["GOOGLE_API_KEY", "SAFETY_GATE_API_KEY"],
  },
  async (req, res) => {
    if (!requireOperationsKey(req, res, { allowAdminKey: true })) return;
    try {
      const year = req.query.year ? Number.parseInt(String(req.query.year), 10) : undefined;
      const fromYear = req.query.fromYear ? Number.parseInt(String(req.query.fromYear), 10) : undefined;
      const toYear = req.query.toYear ? Number.parseInt(String(req.query.toYear), 10) : undefined;
      const maxPages = req.query.maxPages ? Number.parseInt(String(req.query.maxPages), 10) : undefined;

      logger.info("Historical Safety Gate backfill triggered via HTTP", {
        method: req.method,
        url: req.url,
        year,
        fromYear,
        toYear,
      });

      const result = await runHistoricalSafetyGateBackfill({
        year,
        fromYear,
        toYear,
        maxPagesPerYear: maxPages,
      });

      res.status(200).json({
        success: true,
        ...result,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error("Historical Safety Gate backfill failed", { error });
      res.status(500).json({
        success: false,
        message: "Historical Safety Gate backfill failed",
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
    maxInstances: 10,
    secrets: ["GOOGLE_API_KEY", "SAFETY_GATE_API_KEY"],
  },
  handleUpsertMerchantProductRequest,
);

export const runMerchantDeltaMonitoringAPI = onRequest(
  {
    region: "europe-west1",
    memory: "1GiB",
    maxInstances: 5,
    timeoutSeconds: 540,
    secrets: ["GOOGLE_API_KEY", "SAFETY_GATE_API_KEY"],
  },
  handleRunMerchantDeltaMonitoringRequest,
);

export const startMerchantCatalogAuditAPI = onRequest(
  {
    region: "europe-west1",
    memory: "256MiB",
    maxInstances: 5,
    timeoutSeconds: 60,
    secrets: ["SAFETY_GATE_API_KEY"],
  },
  handleStartMerchantCatalogAuditRequest,
);

export const startShopifyProductChangeAPI = onRequest(
  {
    region: "europe-west1",
    memory: "256MiB",
    maxInstances: 20,
    timeoutSeconds: 60,
    secrets: ["SAFETY_GATE_API_KEY"],
  },
  handleStartShopifyProductChangeRequest,
);

export const shopifyProductChangeTask = onTaskDispatched(
  {
    region: "europe-west1",
    memory: "1GiB",
    timeoutSeconds: 1800,
    maxInstances: 10,
    rateLimits: { maxConcurrentDispatches: 4, maxDispatchesPerSecond: 1 },
    retryConfig: {
      maxAttempts: 8,
      maxRetrySeconds: 24 * 60 * 60,
      minBackoffSeconds: 60,
      maxBackoffSeconds: 600,
      maxDoublings: 4,
    },
    secrets: ["GOOGLE_API_KEY"],
  },
  async (request) => {
    await handleShopifyProductChangeTask(request.data, request.context.retryCount);
  },
);

export const merchantCatalogAuditTask = onTaskDispatched(
  {
    region: "europe-west1",
    memory: "1GiB",
    timeoutSeconds: 1800,
    maxInstances: 10,
    rateLimits: { maxConcurrentDispatches: 4, maxDispatchesPerSecond: 1 },
    retryConfig: {
      maxAttempts: 8,
      maxRetrySeconds: 24 * 60 * 60,
      minBackoffSeconds: 60,
      maxBackoffSeconds: 600,
      maxDoublings: 4,
    },
    secrets: ["GOOGLE_API_KEY", "SAFETY_GATE_API_KEY"],
  },
  async (request) => {
    await handleMerchantCatalogAuditTask(request.data, request.context.retryCount);
  },
);

export const dailyMerchantDeltaMonitoring = onSchedule(
  {
    ...SCHEDULER_CONFIG,
    schedule: "47 3 * * *",
    secrets: ["GOOGLE_API_KEY", "SAFETY_GATE_API_KEY"],
  },
  async (event) => {
    logger.info("Starting daily merchant delta monitoring enqueue.", { event });
    const result = await runDailyMerchantDeltaMonitoring(event.scheduleTime);
    logger.info("Daily merchant delta monitoring enqueue completed.", result);
  },
);

export const merchantMonitoringTask = onTaskDispatched(
  {
    region: "europe-west1",
    memory: "1GiB",
    timeoutSeconds: 1800,
    maxInstances: 10,
    rateLimits: { maxConcurrentDispatches: 4, maxDispatchesPerSecond: 1 },
    retryConfig: {
      maxAttempts: 8,
      maxRetrySeconds: 24 * 60 * 60,
      minBackoffSeconds: 60,
      maxBackoffSeconds: 600,
      maxDoublings: 4,
    },
    secrets: ["GOOGLE_API_KEY"],
  },
  async (request) => {
    await handleMerchantMonitoringTask(request.data, request.context.retryCount);
  },
);

export const sendImmediateSafetyGateAlertEmail = onDocumentCreated(
  {
    document: "merchants/{shopId}/alerts/{alertId}",
    retry: true,
    region: "europe-west1",
    secrets: ["BREVO_API_KEY"],
  },
  handleImmediateAlertCreated,
);

export const weeklyClearSafetyGateSummary = onSchedule(
  {
    region: "europe-west1",
    schedule: "0 8 * * 1",
    retryCount: 5,
    minBackoffSeconds: 60,
    maxBackoffSeconds: 300,
    maxRetrySeconds: 1800,
    timeZone: "Europe/Bratislava",
    secrets: ["BREVO_API_KEY"],
  },
  async (event) => {
    const end = event.scheduleTime ? new Date(event.scheduleTime) : new Date();
    logger.info("Starting weekly Safety Gate clear summaries", { end: end.toISOString() });
    const result = await runWeeklyClearSummaries(end);
    logger.info("Weekly Safety Gate clear summaries completed", result);
  },
);

export const brevoEmailWebhook = onRequest(
  {
    region: "europe-west1",
    maxInstances: 10,
    secrets: ["BREVO_WEBHOOK_SECRET"],
  },
  handleBrevoWebhook,
);

// --- Product Safety Checker API ---
export const checkProductSafetyAPI = onRequest(
  {
    region: "europe-west1",
    memory: "512MiB",
    maxInstances: 15,
    timeoutSeconds: 240, // Allow both bounded multimodal matcher batches to complete
    invoker: "public", // Allow unauthenticated access at platform level; API key enforced in code
    secrets: ["GOOGLE_API_KEY", "SAFETY_GATE_API_KEY"],
  },
  handleCheckProductSafetyRequest,
);

export const scanPublicShopifyStoreAPI = onRequest(
  {
    region: "europe-west1",
    memory: "1GiB",
    maxInstances: 3,
    timeoutSeconds: 540,
    secrets: ["GOOGLE_API_KEY", "SAFETY_GATE_API_KEY"],
  },
  handleScanPublicShopifyStoreRequest,
);

// Public marketing-site intake. Confirmed scans continue through durable catalog-page tasks.
export const freeScanRequestAPI = onRequest(
  { region: "europe-west1", maxInstances: 10, secrets: ["TURNSTILE_SECRET_KEY", "BREVO_API_KEY"] },
  handleFreeScanRequest,
);

export const processFreeScanRequestJob = onDocumentUpdated(
  {
    document: "free_scan_requests/{requestId}",
    retry: true,
    region: "europe-west1",
    memory: "1GiB",
    timeoutSeconds: 540,
    maxInstances: 2,
    secrets: ["GOOGLE_API_KEY", "SAFETY_GATE_API_KEY", "BREVO_API_KEY"],
  },
  async (event) => {
    if (event.data?.before.get("status") !== "queued" && event.data?.after.get("status") === "queued") {
      await processFreeScanRequest(event.params.requestId);
    }
  },
);


export const freeScanCatalogTask = onTaskDispatched(
  {
    region: "europe-west1", memory: "1GiB", timeoutSeconds: 1800, maxInstances: 2,
    rateLimits: { maxConcurrentDispatches: 2, maxDispatchesPerSecond: 1 },
    retryConfig: { maxAttempts: 8, maxRetrySeconds: 86400, minBackoffSeconds: 30, maxBackoffSeconds: 300, maxDoublings: 4 },
    secrets: ["GOOGLE_API_KEY", "BREVO_API_KEY"],
  },
  async request => handleFreeScanCatalogTask(request.data, request.context.retryCount),
);


export const notifyFreeScanOwner = onDocumentCreated(
  { document: "free_scan_requests/{requestId}", region: "europe-west1", memory: "256MiB", timeoutSeconds: 60, maxInstances: 2, retry: true, secrets: ["BREVO_API_KEY"] },
  async event => handleFreeScanOwnerCreated(event.params.requestId),
);

// Refresh verified Partner contracts even when merchants leave Shopify Admin closed.
export const refreshShopifyBillingEntitlements = onSchedule(
  { region: "europe-west1", schedule: "every 60 minutes", timeoutSeconds: 540, maxInstances: 1, serviceAccount: "safety-gate-shopify-runtime@rapex-99a2c.iam.gserviceaccount.com", secrets: ["SHOPIFY_PARTNER_API_TOKEN"] },
  async () => {
    const { refreshShopifyEntitlements } = await import("./billing-entitlements.js");
    logger.info("Scheduled billing verification completed", await refreshShopifyEntitlements());
  },
);

/** Read-only operational probe, separate from merchant monitoring. */
export const checkBackendHealth = onSchedule({
  region: "europe-west1", schedule: "17 * * * *", timeZone: "Europe/Bratislava",
  serviceAccount: "safety-gate-backend-health@rapex-99a2c.iam.gserviceaccount.com",
  timeoutSeconds: 300, memory: "256MiB", maxInstances: 1,
}, async () => { await (await import("./backend-health.js")).checkBackendHealth(); });
