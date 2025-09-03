
import * as logger from "firebase-functions/logger";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { onRequest } from "firebase-functions/v2/https";
import { initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp, FieldValue } from "firebase-admin/firestore";
import axios from "axios";
import { checkProductSafety } from "./safety-gate-checker.js";

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

// OpenDataSoft API configuration for enhanced filtering
const ODS_API_CONFIG = {
  dataset: ODS_DATASET,
  baseUrl: ODS_BASE_URL,
  // Available filter fields from OpenDataSoft documentation (corrected field names)
  filterFields: [
    'alert_level', 'alert_group', 'alert_country', 'product_country',
    'product_counterfeit', 'alert_type', 'product_type', 'product_brand',
    'product_category', 'oecd_portal_category', 'technical_defect',
    'alert_other_countries', 'alert_date', 'measures_country'
  ],
  // Default sorting (newest first)
  defaultSort: "-alert_date,-record_timestamp",
  // Enhanced query parameters for better performance
  facets: [
    'alert_level', 'alert_group', 'alert_country', 'product_country',
    'product_counterfeit', 'alert_type', 'product_type', 'product_brand',
    'product_category', 'oecd_portal_category', 'technical_defect',
    'alert_other_countries', 'measures_country'
  ]
};

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
    logger.info("Starting daily Safety Gate delta loader job.", { event });
    await runSafetyGateLoader();
  });

// --- OpenDataSoft API Test Endpoint ---

export const testOpenDataSoftAPI = onRequest(
  {
    region: "europe-west1",
    memory: "256MiB",
  },
  async (req, res) => {
    try {
      logger.info("Testing OpenDataSoft API connection", {
        method: req.method,
        query: req.query
      });

      // Test basic connectivity
      const testParams: any = {
        dataset: ODS_API_CONFIG.dataset,
        rows: 1, // Just get one record for testing
        sort: ODS_API_CONFIG.defaultSort,
      };

      // Add test filters from query parameters using OpenDataSoft query syntax
      const filters: string[] = [];

      if (req.query.category) {
        filters.push(`product_category:"${req.query.category}"`);
      }
      if (req.query.country) {
        filters.push(`alert_country:"${req.query.country}"`);
      }
      if (req.query.risk) {
        filters.push(`risk_level:"${req.query.risk}"`);
      }

      if (filters.length > 0) {
        testParams.q = filters.join(' AND ');
      }

      const response = await axios.get<{
        records: RapexRecord[];
        nhits?: number;
        facet_groups?: any[];
      }>(
        ODS_API_CONFIG.baseUrl,
        {
          params: testParams,
          timeout: 15000,
          headers: {
            'User-Agent': 'Safety-Gate-API-Test/1.0',
            'Accept': 'application/json',
          },
        }
      );

      const result = {
        success: true,
        api: {
          endpoint: ODS_API_CONFIG.baseUrl,
          dataset: ODS_API_CONFIG.dataset,
          parameters: testParams,
        },
        response: {
          status: response.status,
          totalRecords: response.data.nhits || 0,
          recordsReturned: response.data.records?.length || 0,
          facetsAvailable: response.data.facet_groups?.length || 0,
        },
        sampleRecord: response.data.records?.[0] || null,
        timestamp: new Date().toISOString()
      };

      logger.info("OpenDataSoft API test completed successfully", result);
      res.status(200).json(result);

    } catch (error) {
      logger.error("OpenDataSoft API test failed", { error });
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : String(error),
        api: {
          endpoint: ODS_API_CONFIG.baseUrl,
          dataset: ODS_API_CONFIG.dataset,
        },
        timestamp: new Date().toISOString()
      });
    }
  }
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
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error("Manual Safety Gate loader failed", { error });
      res.status(500).json({
        success: false,
        message: "Safety Gate loader failed",
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString()
      });
    }
  });

// --- Shared loader function ---
async function runSafetyGateLoader() {

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

        // Enhanced API request with OpenDataSoft parameters
        const requestParams: any = {
          dataset: ODS_API_CONFIG.dataset,
          sort: ODS_API_CONFIG.defaultSort, // Newest first
          rows: ROWS_PER_PAGE,
          start,
          // Include facets for better filtering capabilities
          facet: ODS_API_CONFIG.facets,
          // Add timezone for consistent date handling
          timezone: 'Europe/Bratislava',
        };

        // Add query filter if exists
        if (queryFilter) {
          requestParams.q = queryFilter;
        }

        // Add refine parameter for more precise filtering if needed
        if (process.env.SAFETY_GATE_FILTER_RISK_LEVEL) {
          requestParams['refine.risk_level'] = process.env.SAFETY_GATE_FILTER_RISK_LEVEL;
        }

        logger.info(`Fetching page ${currentPage + 1} with enhanced parameters`, {
          start,
          rows: ROWS_PER_PAGE,
          queryFilter,
          facets: ODS_API_CONFIG.facets.length
        });

        const response = await axios.get<{
          records: RapexRecord[];
          nhits?: number;
          facet_groups?: any[];
        }>(
          ODS_API_CONFIG.baseUrl,
          {
            params: requestParams,
            timeout: 30000, // 30 second timeout for large datasets
            headers: {
              'User-Agent': 'Safety-Gate-Loader/1.0',
              'Accept': 'application/json',
            },
          },
        );

        const records = response.data.records || [];

        // Enhanced logging with OpenDataSoft API response details
        logger.info(`OpenDataSoft API Response for page ${currentPage + 1}:`, {
          totalRecords: records.length,
          hasFacets: !!response.data.facet_groups,
          facetsCount: response.data.facet_groups?.length || 0,
          datasetId: ODS_API_CONFIG.dataset,
          apiUrl: ODS_API_CONFIG.baseUrl
        });

        if (records.length === 0) {
          logger.info(`No more records found on page ${currentPage + 1}. Stopping pagination.`);
          hasMore = false;
          continue;
        }

        // Validate record structure
        if (records.length > 0 && (!records[0].fields || !records[0].recordid)) {
          logger.error(`Invalid record structure received from OpenDataSoft API`, {
            sampleRecord: records[0],
            apiUrl: ODS_API_CONFIG.baseUrl,
            dataset: ODS_API_CONFIG.dataset
          });
          throw new Error('OpenDataSoft API returned invalid record structure');
        }

        logger.info(`Processing ${records.length} Safety Gate records from page ${currentPage + 1}`);

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
      logger.error("Error running Safety Gate delta loader job.", { error });
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
    secrets: ["GOOGLE_API_KEY", "SAFETY_GATE_API_KEY"],
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
    const expectedApiKey = (process.env.SAFETY_GATE_API_KEY ?? '').toString().trim();

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
