import axios from "axios";
import { createHash, randomUUID } from "node:crypto";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";
import { db } from "./firebase-admin.js";
import { mapBounded } from "./matching-work.js";
import { FIRESTORE_COLLECTIONS } from "./safety-gate-config.js";
import { buildEmbeddingText, embedImage, embedText } from "./safety-gate-embeddings.js";
import {
  parseWeeklyReportsListXml,
  parseWeeklyReportDetailXml,
  type SafetyGateWeeklyNotification,
  type SafetyGateWeeklyReportRef,
} from "./safety-gate-weekly-parser.js";
import type { LoaderState } from "./safety-gate-types.js";
import { extractGtins } from "./gtin.js";
import {
  patchVectorSnapshotIncremental,
  type SnapshotRecord,
} from "./safety-gate-vector-snapshot.js";

const WEEKLY_REPORTS_LIST_URL =
  "https://ec.europa.eu/safety-gate-alerts/api/download/weeklyReport/list/xml/en";

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

const WEEKLY_FETCH_TIMEOUT_MS = 60_000;
const WEEKLY_FETCH_MAX_ATTEMPTS = 3;
const WEEKLY_FETCH_BASE_DELAY_MS = 2_000;

function isRetryableSafetyGateFetchError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const err = error as { code?: string; response?: { status?: number } };
  const status = err.response?.status;
  if (typeof status === "number") {
    return status === 408 || status === 429 || status >= 500;
  }
  if (err.code) {
    return [
      "ECONNABORTED",
      "ETIMEDOUT",
      "ECONNRESET",
      "ENOTFOUND",
      "EAI_AGAIN",
      "ECONNREFUSED",
      "ERR_NETWORK",
    ].includes(err.code);
  }
  return false;
}

export interface SafetyGateXmlFetchOptions {
  timeoutMs?: number;
  maxAttempts?: number;
  baseDelayMs?: number;
  fetcher?: (url: string, timeoutMs: number) => Promise<string>;
  sleep?: (ms: number) => Promise<void>;
}

export async function fetchSafetyGateXmlWithRetry(
  url: string,
  options: SafetyGateXmlFetchOptions = {},
): Promise<string> {
  const timeoutMs = options.timeoutMs ?? WEEKLY_FETCH_TIMEOUT_MS;
  const maxAttempts = Math.max(1, options.maxAttempts ?? WEEKLY_FETCH_MAX_ATTEMPTS);
  const baseDelayMs = options.baseDelayMs ?? WEEKLY_FETCH_BASE_DELAY_MS;
  const fetcher = options.fetcher ?? (async (targetUrl: string, timeout: number) => {
    const response = await axios.get<string>(targetUrl, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/xml, text/xml, */*",
      },
      timeout,
    });
    return response.data;
  });
  const sleep = options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fetcher(url, timeoutMs);
    } catch (error) {
      lastError = error;
      const shouldRetry = attempt < maxAttempts && isRetryableSafetyGateFetchError(error);
      if (!shouldRetry) throw error;
      const delayMs = baseDelayMs * 2 ** (attempt - 1);
      logger.warn("Transient Safety Gate XML fetch failure; retrying", {
        url,
        attempt,
        maxAttempts,
        delayMs,
        code: (error as { code?: string })?.code,
        status: (error as { response?: { status?: number } })?.response?.status,
        message: error instanceof Error ? error.message : String(error),
      });
      await sleep(delayMs);
    }
  }
  throw lastError;
}

export function parseReportDate(dateStr: string): Date {
  if (!dateStr) return new Date();
  if (dateStr.includes("/")) {
    const parts = dateStr.split("/").map(Number);
    if (parts.length === 3) {
      const [d, m, y] = parts;
      return new Date(Date.UTC(y, m - 1, d));
    }
  }
  const parsed = new Date(dateStr);
  return isNaN(parsed.getTime()) ? new Date() : parsed;
}

export function buildAlertImageDocId(alertId: string, imageUrl: string): string {
  const suffix = createHash("sha1").update(imageUrl).digest("hex").slice(0, 24);
  return `${alertId}__${suffix}`;
}

export function buildWeeklyAlertFields(
  notification: SafetyGateWeeklyNotification,
  alertDate: Date,
): Record<string, unknown> {
  const alertDateStr = alertDate.toISOString().split("T")[0];
  return {
    // Official ec.europa.eu schema fields
    caseNumber: notification.caseNumber,
    reference: notification.reference,
    category: notification.category,
    product: notification.product,
    brand: notification.brand,
    name: notification.name,
    type_numberOfModel: notification.type_numberOfModel,
    batchNumber: notification.batchNumber,
    barcode: notification.barcode,
    riskType: notification.riskType,
    danger: notification.danger,
    measures: notification.measures,
    description: notification.description,
    notifyingCountry: notification.notifyingCountry,
    countryOfOrigin: notification.countryOfOrigin,
    type: notification.type,
    level: notification.level,
    pictures: notification.pictures,
    onlineTrader: notification.onlineTrader || "",
    companyRecallCode: notification.companyRecallCode || "",
    productionDates: notification.productionDates || "",
    reportDate: notification.reportDate,
    reportYear: notification.reportYear,
    reportWeek: notification.reportWeek,
    url: notification.reference,

    // Legacy / OpenDataSoft aliases for complete backward compatibility
    alert_number: notification.caseNumber,
    product_category: notification.category,
    product_type: notification.product,
    product_brand: notification.brand,
    product_name: notification.name,
    product_model: notification.type_numberOfModel,
    product_model_type: notification.type_numberOfModel,
    batch_number: notification.batchNumber,
    product_batch_number: notification.batchNumber,
    product_barcode: notification.barcode,
    alert_type: notification.riskType,
    risk_type: notification.riskType,
    alert_description: notification.danger,
    technical_defect: notification.measures,
    measures_country: notification.measures,
    product_description: notification.description,
    notifying_country: notification.notifyingCountry,
    alert_country: notification.notifyingCountry,
    country_of_origin: notification.countryOfOrigin,
    product_country: notification.countryOfOrigin,
    alert_level: notification.level,
    risk_level: notification.level,
    product_image: notification.pictures[0] || "",
    product_other_images: notification.pictures.slice(1).join(","),
    rapex_url: notification.reference,
    alert_date: alertDateStr,
  };
}

export async function fetchWeeklyReportsList(
  options?: SafetyGateXmlFetchOptions,
): Promise<SafetyGateWeeklyReportRef[]> {
  logger.info(`Fetching Safety Gate weekly reports list from ${WEEKLY_REPORTS_LIST_URL}`);
  const xml = await fetchSafetyGateXmlWithRetry(WEEKLY_REPORTS_LIST_URL, options);
  return parseWeeklyReportsListXml(xml);
}

export async function fetchWeeklyReportDetail(
  reportUrl: string,
  year: number,
  week: number,
  options?: SafetyGateXmlFetchOptions,
): Promise<SafetyGateWeeklyNotification[]> {
  logger.info(`Fetching weekly report detail for year ${year}, week ${week}: ${reportUrl}`);
  const xml = await fetchSafetyGateXmlWithRetry(reportUrl, options);
  return parseWeeklyReportDetailXml(xml, year, week);
}

async function findExistingAlertDocId(caseNumber: string): Promise<string | null> {
  const deterministicId = createHash("sha1").update(`ec-safety-gate-${caseNumber}`).digest("hex");
  const directSnap = await db.collection(FIRESTORE_COLLECTIONS.alerts).doc(deterministicId).get();
  if (directSnap.exists) {
    return deterministicId;
  }

  const queryByCase = await db
    .collection(FIRESTORE_COLLECTIONS.alerts)
    .where("fields.caseNumber", "==", caseNumber)
    .limit(1)
    .get();

  if (!queryByCase.empty) {
    return queryByCase.docs[0].id;
  }

  const queryByAlertNumber = await db
    .collection(FIRESTORE_COLLECTIONS.alerts)
    .where("fields.alert_number", "==", caseNumber)
    .limit(1)
    .get();

  if (!queryByAlertNumber.empty) {
    return queryByAlertNumber.docs[0].id;
  }

  return null;
}

export interface WeeklySyncResult {
  reportsProcessed: number;
  notificationsProcessed: number;
  newAlertsCreated: number;
  alertsUpdated: number;
  imagesEmbedded: number;
  latestYear: number;
  latestWeek: number;
  latestAlertDate: Date;
}

export async function ingestWeeklyNotification(
  notification: SafetyGateWeeklyNotification,
): Promise<{
  created: boolean;
  updated: boolean;
  imagesEmbedded: number;
  textUpsert?: SnapshotRecord;
  imageUpserts: SnapshotRecord[];
  deletedImageDocIds: string[];
}> {
  const alertDate = parseReportDate(notification.reportDate);
  const fields = buildWeeklyAlertFields(notification, alertDate);

  // Check if document already exists
  const existingDocId = await findExistingAlertDocId(notification.caseNumber);
  const docId =
    existingDocId ||
    createHash("sha1").update(`ec-safety-gate-${notification.caseNumber}`).digest("hex");
  const docRef = db.collection(FIRESTORE_COLLECTIONS.alerts).doc(docId);

  let existingData: Record<string, unknown> | undefined;
  if (existingDocId) {
    const snap = await docRef.get();
    existingData = snap.data();
  }

  const contentHash = createHash("sha256").update(JSON.stringify(fields)).digest("hex");
  const previousHash = (existingData?.meta as Record<string, unknown> | undefined)?.content_hash;
  const contentChanged = previousHash !== contentHash;
  // A changed source must never keep an old text embedding.
  let vectorText = existingData?.vector_text as unknown;
  let textUpsert: SnapshotRecord | undefined;
  if (!vectorText || contentChanged) {
    const textToEmbed = buildEmbeddingText({
      brand: notification.brand,
      model: notification.type_numberOfModel || notification.product,
      category: notification.category,
      title: notification.name || notification.product,
      description: notification.description || notification.danger,
    });
    const embedding = await embedText(textToEmbed);
    if (!embedding?.length) throw new Error(`Safety Gate text embedding unavailable: ${docId}`);
    vectorText = FieldValue.vector(embedding);
    textUpsert = { docId, vector: embedding };
  }

  // Embed images
  let imagesEmbeddedCount = 0;
  const imageUpserts: SnapshotRecord[] = [];

  if (notification.pictures.length > 0) {
    await mapBounded(
      notification.pictures.map((imgUrl, index) => ({ imgUrl, index })),
      3,
      async ({ imgUrl, index }) => {
        const imageDocId = buildAlertImageDocId(docId, imgUrl);
        const imgDocRef = db.collection(FIRESTORE_COLLECTIONS.alertImages).doc(imageDocId);
        const imgSnap = await imgDocRef.get();

        if (!imgSnap.exists) {
          const imgVector = await embedImage(imgUrl);
          if (imgVector?.length) {
            imagesEmbeddedCount++;
            const imageBatch = db.batch();
            imageBatch.set(imgDocRef, {
              alertId: docId,
              imageUrl: imgUrl,
              imageIndex: index,
              meta: {
                datasetid: "ec.europa.eu-safety-gate",
                recordid: docId,
                alert_date: Timestamp.fromDate(alertDate),
                ingested_at: FieldValue.serverTimestamp(),
              },
              vector_image: FieldValue.vector(imgVector),
              updatedAt: FieldValue.serverTimestamp(),
            });
            // Image-only repairs must enter the same journal atomically, even
            // if this notification later fails before its alert transaction.
            imageBatch.set(db.collection("rapex_changes").doc(`image_${randomUUID()}`), {
              alertId: docId, contentHash, changeType: "image_upsert", changedAt: FieldValue.serverTimestamp(),
            });
            await imageBatch.commit();
            imageUpserts.push({
              docId: imageDocId,
              alertId: docId,
              imageUrl: imgUrl,
              vector: imgVector,
            });
          }
        }
      },
    );
  }

  const revisionTimestamp = contentChanged ? new Date().toISOString()
    : String((existingData?.meta as Record<string, unknown> | undefined)?.record_timestamp || new Date().toISOString());
  const alertDocData: Record<string, unknown> = {
    meta: {
      datasetid: "ec.europa.eu-safety-gate",
      recordid: docId,
      record_timestamp: revisionTimestamp,
      content_hash: contentHash,
      alert_date: Timestamp.fromDate(alertDate),
      ingested_at: existingData ? (existingData.meta as any)?.ingested_at || FieldValue.serverTimestamp() : FieldValue.serverTimestamp(),
      updated_at: FieldValue.serverTimestamp(),
    },
    fields,
    gtins: extractGtins(notification.barcode),
  };

  if (vectorText) {
    alertDocData.vector_text = vectorText;
  }
  alertDocData.vector_image = FieldValue.delete();
  await db.runTransaction(async (transaction) => {
    const latest = await transaction.get(docRef);
    transaction.set(docRef, alertDocData, { merge: true });
    if (latest.get("meta.content_hash") !== contentHash) {
      // Immutable change journal: corrections to old publications are not hidden by alert_date.
      const changeId = `${revisionTimestamp}_${docId}_${contentHash.slice(0, 12)}`;
      transaction.set(db.collection("rapex_changes").doc(changeId), {
        alertId: docId, contentHash, changedAt: FieldValue.serverTimestamp(),
      });
    }
  });
  const deletedImageDocIds: string[] = [];
  const oldPictures = ((existingData?.fields as Record<string, unknown> | undefined)?.pictures || []) as string[];
  for (const url of oldPictures) {
    if (!notification.pictures.includes(url)) {
      const deletedImageDocId = buildAlertImageDocId(docId, url);
      const imageBatch = db.batch();
      imageBatch.delete(db.collection(FIRESTORE_COLLECTIONS.alertImages).doc(deletedImageDocId));
      imageBatch.set(db.collection("rapex_changes").doc(`image_${randomUUID()}`), {
        alertId: docId, contentHash, changeType: "image_delete", changedAt: FieldValue.serverTimestamp(),
      });
      await imageBatch.commit();
      deletedImageDocIds.push(deletedImageDocId);
    }
  }

  return {
    created: !existingDocId,
    updated: Boolean(existingDocId) && contentChanged,
    imagesEmbedded: imagesEmbeddedCount,
    ...(textUpsert ? { textUpsert } : {}),
    imageUpserts,
    deletedImageDocIds,
  };
}

export async function runSafetyGateWeeklyLoaderJob(options?: {
  weeks?: number[];
  year?: number;
  forceSyncAllReports?: boolean;
}): Promise<WeeklySyncResult> {
  const runStart = Timestamp.now();
  const loaderStateRef = db
    .collection(FIRESTORE_COLLECTIONS.meta)
    .doc(FIRESTORE_COLLECTIONS.loaderStateDoc);

  await loaderStateRef.set(
    {
      last_run_start: runStart,
      last_run_status: "IN_PROGRESS",
    },
    { merge: true },
  );

  try {
    const reportsList = await fetchWeeklyReportsList();
    const stateDoc = await loaderStateRef.get();
    const lastState = (stateDoc.data() || {}) as LoaderState & {
      last_report_year?: number;
      last_report_week?: number;
    };

    let targetReports: SafetyGateWeeklyReportRef[] = [];

    if (options?.weeks?.length && options.year) {
      const weekSet = new Set(options.weeks);
      targetReports = reportsList.filter(
        (r) => r.year === options.year && weekSet.has(r.week),
      );
    } else if (options?.forceSyncAllReports) {
      targetReports = reportsList;
    } else {
      // Default: Find all reports newer than the last synced report
      const lastYear = lastState.last_report_year ?? 2026;
      const lastWeek = lastState.last_report_week ?? 30; // default to week 30 if not tracked

      targetReports = reportsList.filter(
        (r) => r.year > lastYear || (r.year === lastYear && r.week > lastWeek),
      );

      // If up to date, check if the latest report needs a refresh (current week)
      if (targetReports.length === 0 && reportsList.length > 0) {
        targetReports = [reportsList[0]];
      }
    }

    // Sort ascending by year and week to process oldest first
    targetReports.sort((a, b) => a.year - b.year || a.week - b.week);

    logger.info(`Found ${targetReports.length} weekly reports to sync from ec.europa.eu.`);

    let notificationsProcessed = 0;
    let notificationFailures = 0;
    let newAlertsCreated = 0;
    let alertsUpdated = 0;
    let imagesEmbedded = 0;
    const textUpserts: SnapshotRecord[] = [];
    const imageUpserts: SnapshotRecord[] = [];
    const deletedImageDocIds: string[] = [];
    let latestYear = lastState.last_report_year || 2026;
    let latestWeek = lastState.last_report_week || 30;
    let latestAlertDate = lastState.last_alert_date?.toDate() || new Date("2026-08-01");

    for (const report of targetReports) {
      logger.info(`Syncing Safety Gate Report ${report.reference} (Year ${report.year}, Week ${report.week})`);
      const notifications = await fetchWeeklyReportDetail(report.url, report.year, report.week);
      logger.info(`Report ${report.reference} contains ${notifications.length} alerts.`);

      await mapBounded(notifications, 4, async (notif) => {
        try {
          const result = await ingestWeeklyNotification(notif);
          notificationsProcessed++;
          if (result.created) newAlertsCreated++;
          if (result.updated) alertsUpdated++;
          imagesEmbedded += result.imagesEmbedded;
          if (result.textUpsert) textUpserts.push(result.textUpsert);
          if (result.imageUpserts.length > 0) imageUpserts.push(...result.imageUpserts);
          if (result.deletedImageDocIds.length > 0) deletedImageDocIds.push(...result.deletedImageDocIds);

          const notifDate = parseReportDate(notif.reportDate);
          if (notifDate > latestAlertDate) {
            latestAlertDate = notifDate;
          }
        } catch (itemError) {
          notificationFailures++;
          logger.error(`Error ingesting notification ${notif.caseNumber}:`, itemError);
        }
      });

      if (report.year > latestYear || (report.year === latestYear && report.week > latestWeek)) {
        latestYear = report.year;
        latestWeek = report.week;
      }
    }

    if (notificationFailures > 0) {
      throw new Error(`Weekly Safety Gate sync had ${notificationFailures} notification ingestion failure(s)`);
    }

    const runEnd = Timestamp.now();
    await loaderStateRef.set(
      {
        last_alert_date: Timestamp.fromDate(latestAlertDate),
        last_run_end: runEnd,
        last_run_status: "SUCCESS",
        last_run_processed_records: notificationsProcessed,
        last_report_year: latestYear,
        last_report_week: latestWeek,
        source: "ec.europa.eu",
      },
      { merge: true },
    );

    try {
      await patchVectorSnapshotIncremental({
        textUpserts,
        imageUpserts,
        deletedImageDocIds,
        coveredThrough: runStart.toDate(),
      });
    } catch (snapshotError) {
      logger.warn("Failed to incrementally patch vector snapshot after weekly sync", {
        error: snapshotError instanceof Error ? snapshotError.message : String(snapshotError),
      });
    }

    const summary: WeeklySyncResult = {
      reportsProcessed: targetReports.length,
      notificationsProcessed,
      newAlertsCreated,
      alertsUpdated,
      imagesEmbedded,
      latestYear,
      latestWeek,
      latestAlertDate,
    };

    logger.info("Safety Gate weekly loader job completed successfully", summary);
    return summary;
  } catch (error) {
    logger.error("Safety Gate weekly loader job failed:", error);
    await loaderStateRef.set(
      {
        last_run_end: Timestamp.now(),
        last_run_status: "FAILURE",
      },
      { merge: true },
    );
    throw error;
  }
}
