import axios from "axios";
import { createHash } from "node:crypto";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";
import { db } from "./firebase-admin.js";
import { FIRESTORE_COLLECTIONS } from "./safety-gate-config.js";
import { buildEmbeddingText, embedImage, embedText } from "./safety-gate-embeddings.js";
import {
  parseWeeklyReportsListXml,
  parseWeeklyReportDetailXml,
  type SafetyGateWeeklyNotification,
  type SafetyGateWeeklyReportRef,
} from "./safety-gate-weekly-parser.js";
import type { LoaderState } from "./safety-gate-types.js";

const WEEKLY_REPORTS_LIST_URL =
  "https://ec.europa.eu/safety-gate-alerts/api/download/weeklyReport/list/xml/en";

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

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

export async function fetchWeeklyReportsList(): Promise<SafetyGateWeeklyReportRef[]> {
  logger.info(`Fetching Safety Gate weekly reports list from ${WEEKLY_REPORTS_LIST_URL}`);
  const response = await axios.get<string>(WEEKLY_REPORTS_LIST_URL, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "application/xml, text/xml, */*",
    },
    timeout: 30000,
  });

  return parseWeeklyReportsListXml(response.data);
}

export async function fetchWeeklyReportDetail(
  reportUrl: string,
  year: number,
  week: number,
): Promise<SafetyGateWeeklyNotification[]> {
  logger.info(`Fetching weekly report detail for year ${year}, week ${week}: ${reportUrl}`);
  const response = await axios.get<string>(reportUrl, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "application/xml, text/xml, */*",
    },
    timeout: 45000,
  });

  return parseWeeklyReportDetailXml(response.data, year, week);
}

async function findExistingAlertDocId(caseNumber: string): Promise<string | null> {
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
): Promise<{ created: boolean; updated: boolean; imagesEmbedded: number }> {
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

  // Generate text embedding if missing
  let vectorText = existingData?.vector_text as unknown;
  if (!vectorText) {
    const textToEmbed = buildEmbeddingText({
      brand: notification.brand,
      model: notification.type_numberOfModel || notification.product,
      category: notification.category,
      title: notification.name || notification.product,
      description: notification.description || notification.danger,
    });
    const embedding = await embedText(textToEmbed);
    if (embedding?.length) {
      vectorText = FieldValue.vector(embedding);
    }
  }

  // Embed images
  let imagesEmbeddedCount = 0;
  let primaryImageVector = existingData?.vector_image as unknown;

  if (notification.pictures.length > 0) {
    for (let i = 0; i < notification.pictures.length; i++) {
      const imgUrl = notification.pictures[i];
      const imageDocId = buildAlertImageDocId(docId, imgUrl);
      const imgDocRef = db.collection(FIRESTORE_COLLECTIONS.alertImages).doc(imageDocId);
      const imgSnap = await imgDocRef.get();

      if (!imgSnap.exists) {
        const imgVector = await embedImage(imgUrl);
        if (imgVector?.length) {
          imagesEmbeddedCount++;
          if (i === 0 && !primaryImageVector) {
            primaryImageVector = FieldValue.vector(imgVector);
          }
          await imgDocRef.set({
            alertId: docId,
            imageUrl: imgUrl,
            imageIndex: i,
            meta: {
              datasetid: "ec.europa.eu-safety-gate",
              recordid: docId,
              alert_date: Timestamp.fromDate(alertDate),
              ingested_at: FieldValue.serverTimestamp(),
            },
            vector_image: FieldValue.vector(imgVector),
            updatedAt: FieldValue.serverTimestamp(),
          });
        }
      }
    }
  }

  const alertDocData: Record<string, unknown> = {
    meta: {
      datasetid: "ec.europa.eu-safety-gate",
      recordid: docId,
      record_timestamp: new Date().toISOString(),
      alert_date: Timestamp.fromDate(alertDate),
      ingested_at: existingData ? (existingData.meta as any)?.ingested_at || FieldValue.serverTimestamp() : FieldValue.serverTimestamp(),
      updated_at: FieldValue.serverTimestamp(),
    },
    fields,
  };

  if (vectorText) {
    alertDocData.vector_text = vectorText;
  }
  if (primaryImageVector) {
    alertDocData.vector_image = primaryImageVector;
  }

  await docRef.set(alertDocData, { merge: true });

  return {
    created: !existingDocId,
    updated: Boolean(existingDocId),
    imagesEmbedded: imagesEmbeddedCount,
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
    let newAlertsCreated = 0;
    let alertsUpdated = 0;
    let imagesEmbedded = 0;
    let latestYear = lastState.last_report_year || 2026;
    let latestWeek = lastState.last_report_week || 30;
    let latestAlertDate = lastState.last_alert_date?.toDate() || new Date("2026-08-01");

    for (const report of targetReports) {
      logger.info(`Syncing Safety Gate Report ${report.reference} (Year ${report.year}, Week ${report.week})`);
      const notifications = await fetchWeeklyReportDetail(report.url, report.year, report.week);
      logger.info(`Report ${report.reference} contains ${notifications.length} alerts.`);

      for (const notif of notifications) {
        try {
          const result = await ingestWeeklyNotification(notif);
          notificationsProcessed++;
          if (result.created) newAlertsCreated++;
          if (result.updated) alertsUpdated++;
          imagesEmbedded += result.imagesEmbedded;

          const notifDate = parseReportDate(notif.reportDate);
          if (notifDate > latestAlertDate) {
            latestAlertDate = notifDate;
          }
        } catch (itemError) {
          logger.error(`Error ingesting notification ${notif.caseNumber}:`, itemError);
        }
      }

      if (report.year > latestYear || (report.year === latestYear && report.week > latestWeek)) {
        latestYear = report.year;
        latestWeek = report.week;
      }
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
