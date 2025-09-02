
import * as logger from "firebase-functions/logger";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { onRequest } from "firebase-functions/v2/https";
import { initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp, FieldValue } from "firebase-admin/firestore";
import axios from "axios";
import { checkProductSafety } from "./product-safety-checker.js";

// Initialize Firebase Admin SDK
// Make sure to set up service account credentials in your environment
// https://firebase.google.com/docs/functions/beta/configuring-env-variables
try {
  initializeApp();
} catch (e) {
  logger.error("Failed to initialize Firebase Admin SDK.", e);
}


const db = getFirestore();

// --- Configuration ---
const ODS_DATASET = "healthref-europe-rapex-en";
const ODS_BASE_URL = "https://public.opendatasoft.com/api/records/1.0/search";
const FIRESTORE_COLLECTION = "rapex_alerts";
const META_COLLECTION = "rapex_meta";
const META_DOC = "loader_state";
const ROWS_PER_PAGE = parseInt(process.env.ROWS_PER_PAGE || "500", 10);
const MAX_PAGES = parseInt(process.env.MAX_PAGES || "20", 10);
const BOOTSTRAP_DAYS = 30; // Days to fetch on the first run

// --- Type Definitions ---
interface LoaderState {
  last_alert_date: Timestamp | null;
  last_record_timestamp: string | null;
  last_run_start: Timestamp | null;
  last_run_end: Timestamp | null;
  last_run_status: "SUCCESS" | "FAILURE" | "IN_PROGRESS";
  last_run_processed_records?: number;
}

interface RapexRecord {
  datasetid: string;
  recordid: string;
  fields: {
    [key: string]: any;
    alert_date: string; // e.g., "2025-08-29"
  };
  record_timestamp: string; // ISO 8601 format e.g., "2025-08-29T08:00:00+00:00"
}

interface RapexAlertDocument {
  meta: {
    datasetid: string;
    recordid: string;
    record_timestamp: string;
    alert_date: Timestamp;
    ingested_at: FieldValue;
  };
  fields: {
    [key: string]: any;
  };
}

// --- Scheduled Function ---
export const dailyRapexDeltaLoader = onSchedule(
  {
    schedule: "13 3 * * *",
    timeZone: "Europe/Bratislava",
    region: "europe-west1", // Recommended region for European users
  },
  async (event: any) => {
    logger.info("Starting daily RAPEX delta loader job.", { event });
    await runRapexLoader();
  });

// --- Manual HTTP Trigger for Testing ---

export const manualRapexLoader = onRequest(
  {
    region: "europe-west1",
    memory: "256MiB",
  },
  async (req, res) => {
    try {
      logger.info("Manual RAPEX loader triggered via HTTP", { method: req.method, url: req.url });

      await runRapexLoader();

      res.status(200).json({
        success: true,
        message: "RAPEX loader completed successfully",
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error("Manual RAPEX loader failed", { error });
      res.status(500).json({
        success: false,
        message: "RAPEX loader failed",
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString()
      });
    }
  });

// --- Shared loader function ---
async function runRapexLoader() {

    const stateRef = db.collection(META_COLLECTION).doc(META_DOC);
    const runStartTime = Timestamp.now();

    try {
      // Mark job as IN_PROGRESS
      await stateRef.set({
        last_run_start: runStartTime,
        last_run_status: "IN_PROGRESS",
      }, { merge: true });

      const stateDoc = await stateRef.get();
      const { last_alert_date, last_record_timestamp } = (stateDoc.data() as LoaderState) || {
        last_alert_date: null,
        last_record_timestamp: null,
      };

      let queryFilter: string | undefined;
      if (last_alert_date) {
        // Format to YYYY-MM-DD for ODS query
        const filterDate = last_alert_date.toDate().toISOString().split("T")[0];
        queryFilter = `alert_date >= '${filterDate}'`;
        logger.info(`Delta load mode. Filtering records from alert_date >= ${filterDate}.`);
      } else {
        // Bootstrap mode
        const bootstrapDate = new Date();
        bootstrapDate.setDate(bootstrapDate.getDate() - BOOTSTRAP_DAYS);
        const filterDate = bootstrapDate.toISOString().split("T")[0];
        queryFilter = `alert_date >= '${filterDate}'`;
        logger.info(`Bootstrap mode. Loading last ${BOOTSTRAP_DAYS} days (from alert_date >= ${filterDate}).`);
      }

      const bulkWriter = db.bulkWriter();
      let totalProcessed = 0;
      let currentPage = 0;
      let hasMore = true;
      let newMaxAlertDate = last_alert_date ? last_alert_date.toDate() : new Date(0);
      let newMaxRecordTimestamp = last_record_timestamp || "";

      while (hasMore && currentPage < MAX_PAGES) {
        const start = currentPage * ROWS_PER_PAGE;
        const response = await axios.get<{ records: RapexRecord[] }>(
          ODS_BASE_URL,
          {
            params: {
              dataset: ODS_DATASET,
              sort: "-alert_date,-record_timestamp", // Newest first
              rows: ROWS_PER_PAGE,
              start,
              q: queryFilter,
            },
          },
        );

        const records = response.data.records || [];
        if (records.length === 0) {
          hasMore = false;
          continue;
        }

        logger.info(`Fetched page ${currentPage + 1}. Records: ${records.length}`);

        for (const record of records) {
          const recordAlertDate = new Date(record.fields.alert_date);
          const recordTimestamp = record.record_timestamp;

          // Stop if we reach a record we've already processed in a previous run
          if (
            last_alert_date &&
            last_record_timestamp &&
            recordAlertDate.getTime() < last_alert_date.toDate().getTime()
          ) {
            hasMore = false;
            break;
          }
          if (
            last_alert_date &&
            last_record_timestamp &&
            recordAlertDate.getTime() === last_alert_date.toDate().getTime() &&
            recordTimestamp <= last_record_timestamp
          ) {
            continue; // Skip records from the same day that are older or same
          }

          // Prepare document for Firestore
          const docData: RapexAlertDocument = {
            meta: {
              datasetid: record.datasetid,
              recordid: record.recordid,
              record_timestamp: record.record_timestamp,
              alert_date: Timestamp.fromDate(recordAlertDate),
              ingested_at: FieldValue.serverTimestamp(),
            },
            fields: record.fields,
          };

          const docRef = db.collection(FIRESTORE_COLLECTION).doc(record.recordid);
          bulkWriter.set(docRef, docData, { merge: true });
          totalProcessed++;

          // Track the newest record timestamp for the next run
          if (recordAlertDate.getTime() > newMaxAlertDate.getTime()) {
            newMaxAlertDate = recordAlertDate;
            newMaxRecordTimestamp = recordTimestamp;
          } else if (
            recordAlertDate.getTime() === newMaxAlertDate.getTime() &&
            recordTimestamp > newMaxRecordTimestamp
          ) {
            newMaxRecordTimestamp = recordTimestamp;
          }
        }

        currentPage++;
      }

      await bulkWriter.close();
      logger.info(`Successfully processed and upserted ${totalProcessed} records.`);

      // Update state for the next run
      const finalState: Partial<LoaderState> = {
        last_run_end: Timestamp.now(),
        last_run_status: "SUCCESS",
        last_run_processed_records: totalProcessed,
      };

      if (totalProcessed > 0) {
        finalState.last_alert_date = Timestamp.fromDate(newMaxAlertDate);
        finalState.last_record_timestamp = newMaxRecordTimestamp;
      }

      await stateRef.set(finalState, { merge: true });
      logger.info("Job finished successfully.", { finalState });

    } catch (error) {
      logger.error("Error running RAPEX delta loader job.", { error });
      await stateRef.set({
        last_run_end: Timestamp.now(),
        last_run_status: "FAILURE",
      }, { merge: true });
      // Re-throw error to signal failure to Cloud Functions
      throw error;
    }
}

// --- Product Safety Checker API ---
export const checkProductSafetyAPI = onRequest(
  {
    region: "europe-west1",
    memory: "512MiB",
    timeoutSeconds: 120, // Longer timeout for AI processing
    invoker: "public", // Allow unauthenticated access at platform level; API key enforced in code
    secrets: ["GOOGLE_API_KEY", "RAPEX_API_KEY"],
  },
  async (req, res) => {
    // Enable CORS
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type, X-API-Key');

    if (req.method === 'OPTIONS') {
      res.status(204).send('');
      return;
    }

    // Verify API key (robust parsing and comparison)
    const headerValue = req.headers['x-api-key'];
    const queryValue = req.query.apiKey as string | string[] | undefined;
    const providedKeyRaw = Array.isArray(headerValue)
      ? headerValue[0]
      : (headerValue as string | undefined) ?? (Array.isArray(queryValue) ? queryValue[0] : queryValue);
    const providedKey = (providedKeyRaw ?? '').toString().trim();
    const expectedApiKey = (process.env.RAPEX_API_KEY ?? '').toString().trim();

    if (!providedKey || !expectedApiKey || providedKey !== expectedApiKey) {
      logger.warn("Unauthorized API access attempt", {
        hasApiKey: !!providedKey,
        apiKeyLength: providedKey.length,
        expectedKeyLength: expectedApiKey.length
      });
      res.status(401).json({
        error: "Unauthorized",
        message: "Valid API key required"
      });
      return;
    }

    try {
      logger.info("Product safety check API called", {
        method: req.method,
        hasBody: !!req.body,
        query: req.query,
        authorized: true
      });

      let productData;

      if (req.method === 'POST' && req.body) {
        // POST request with JSON body
        productData = req.body;
      } else if (req.method === 'GET' && req.query) {
        // GET request with query parameters
        productData = {
          name: req.query.name || req.query.product,
          category: req.query.category,
          description: req.query.description,
          imageUrl: req.query.imageUrl,
          brand: req.query.brand,
          model: req.query.model,
        };
      } else {
        res.status(400).json({
          error: "Missing product data",
          usage: {
            GET: "/checkProductSafetyAPI?name=Product&category=toys&description=Description",
            POST: "/checkProductSafetyAPI with JSON body: {name, category, description, imageUrl?, brand?, model?}"
          }
        });
        return;
      }

      // No testLatest mode; API key is required for AI analysis

      // Validate required fields
      if (!productData.name || !productData.category || !productData.description) {
        res.status(400).json({
          error: "Missing required fields",
          required: ["name", "category", "description"],
          provided: productData
        });
        return;
      }

      logger.info("Processing product safety check", { productData });

      // Run the Genkit flow (requires GOOGLE_API_KEY secret)
      const result = await checkProductSafety(productData);

      logger.info("Product safety check completed", {
        isSafe: result.isSafe,
        warningsCount: result.warnings.length
      });

      res.status(200).json(result);

    } catch (error) {
      logger.error("Product safety check API error", { error });

      res.status(500).json({
        error: "Internal server error",
        message: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString()
      });
    }
  }
);
