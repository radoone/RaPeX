import axios from "axios";
import { createHash } from "node:crypto";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";
import { db } from "./firebase-admin.js";
import {
  FIRESTORE_COLLECTIONS,
  SAFETY_GATE_CONFIG,
  SAFETY_GATE_HEADERS,
} from "./safety-gate-config.js";
import { embedImage, embedText, getPictureUrls } from "./safety-gate-embeddings.js";
import type {
  LoaderState,
  OpenDataSoftResponse,
  RapexAlertDocument,
  RapexAlertImageDocument,
  RapexRecord,
} from "./safety-gate-types.js";

type LoaderProgress = {
  totalProcessed: number;
  currentPage: number;
  hasMore: boolean;
  newestAlertDate: Date;
  newestRecordTimestamp: string;
};

type ImageEmbeddingPayload = {
  url: string;
  imageIndex: number;
  vector: number[];
};

type ExistingAlertEmbeddingState = {
  hasTextVector: boolean;
  hasPrimaryImageVector: boolean;
  existingImageDocIds: Set<string>;
};

function getLoaderStateRef() {
  return db
    .collection(FIRESTORE_COLLECTIONS.meta)
    .doc(FIRESTORE_COLLECTIONS.loaderStateDoc);
}

function formatDateForQuery(date: Date): string {
  return date.toISOString().split("T")[0];
}

function buildQueryFilter(lastAlertDate: Timestamp | null): string {
  if (lastAlertDate) {
    const filterDate = formatDateForQuery(lastAlertDate.toDate());
    logger.info(`Delta load mode. Filtering records from alert_date >= ${filterDate}.`);
    return `alert_date >= '${filterDate}'`;
  }

  const bootstrapDate = new Date();
  bootstrapDate.setDate(bootstrapDate.getDate() - SAFETY_GATE_CONFIG.bootstrapDays);
  const filterDate = formatDateForQuery(bootstrapDate);
  logger.info(
    `Bootstrap mode. Loading last ${SAFETY_GATE_CONFIG.bootstrapDays} days (from alert_date >= ${filterDate}).`,
  );
  return `alert_date >= '${filterDate}'`;
}

function buildLoaderRequestParams(start: number, queryFilter: string) {
  const params: Record<string, unknown> = {
    dataset: SAFETY_GATE_CONFIG.dataset,
    sort: SAFETY_GATE_CONFIG.defaultSort,
    rows: SAFETY_GATE_CONFIG.rowsPerPage,
    start,
    facet: SAFETY_GATE_CONFIG.facets,
    timezone: "Europe/Bratislava",
    q: queryFilter,
  };

  if (SAFETY_GATE_CONFIG.filterRiskLevel) {
    params["refine.risk_level"] = SAFETY_GATE_CONFIG.filterRiskLevel;
  }

  return params;
}

async function fetchOpenDataSoftRecords(
  params: Record<string, unknown>,
  userAgent: string,
  timeout: number,
): Promise<{ data: OpenDataSoftResponse; status: number }> {
  const response = await axios.get<OpenDataSoftResponse>(SAFETY_GATE_CONFIG.baseUrl, {
    params,
    timeout,
    headers: {
      "User-Agent": userAgent,
      Accept: SAFETY_GATE_HEADERS.accept,
    },
  });

  return {
    data: response.data,
    status: response.status,
  };
}

async function getExistingAlertEmbeddingState(alertId: string): Promise<ExistingAlertEmbeddingState> {
  const alertDoc = await db.collection(FIRESTORE_COLLECTIONS.alerts).doc(alertId).get();
  const alertData = (alertDoc.data() as Record<string, unknown> | undefined) || {};
  const imageDocs = await db.collection(FIRESTORE_COLLECTIONS.alertImages).where("alertId", "==", alertId).get();

  return {
    hasTextVector: hasStoredVectorField(alertData, "vector_text"),
    hasPrimaryImageVector: hasStoredVectorField(alertData, "vector_image"),
    existingImageDocIds: new Set(imageDocs.docs.map((doc) => doc.id)),
  };
}

async function loadRecentAlertImageDocIdsByAlertId(cutoffDate: Date): Promise<Map<string, Set<string>>> {
  const snapshot = await db
    .collection(FIRESTORE_COLLECTIONS.alertImages)
    .where("meta.alert_date", ">=", Timestamp.fromDate(cutoffDate))
    .select("alertId")
    .get();

  const imageDocIdsByAlertId = new Map<string, Set<string>>();
  for (const doc of snapshot.docs) {
    const alertId = String(doc.get("alertId") || "").trim();
    if (!alertId) {
      continue;
    }

    const current = imageDocIdsByAlertId.get(alertId) ?? new Set<string>();
    current.add(doc.id);
    imageDocIdsByAlertId.set(alertId, current);
  }

  return imageDocIdsByAlertId;
}

function validateRecords(records: RapexRecord[]): void {
  if (records.length > 0 && (!records[0].fields || !records[0].recordid)) {
    logger.error("Invalid record structure received from OpenDataSoft API", {
      sampleRecord: records[0],
      apiUrl: SAFETY_GATE_CONFIG.baseUrl,
      dataset: SAFETY_GATE_CONFIG.dataset,
    });
    throw new Error("OpenDataSoft API returned invalid record structure");
  }
}

function shouldStopOnOlderRecord(record: RapexRecord, lastState: LoaderState): boolean {
  return Boolean(
    lastState.last_alert_date &&
      lastState.last_record_timestamp &&
      new Date(record.fields.alert_date).getTime() < lastState.last_alert_date.toDate().getTime(),
  );
}

function shouldSkipAlreadyProcessedRecord(record: RapexRecord, lastState: LoaderState): boolean {
  return Boolean(
    lastState.last_alert_date &&
      lastState.last_record_timestamp &&
      new Date(record.fields.alert_date).getTime() === lastState.last_alert_date.toDate().getTime() &&
      record.record_timestamp <= lastState.last_record_timestamp,
  );
}

function buildAlertDocument(
  record: RapexRecord,
  recordAlertDate: Date,
  vectorText?: number[],
  vectorImage?: number[],
): RapexAlertDocument {
  const document: RapexAlertDocument = {
    meta: {
      datasetid: record.datasetid,
      recordid: record.recordid,
      record_timestamp: record.record_timestamp,
      alert_date: Timestamp.fromDate(recordAlertDate),
      ingested_at: FieldValue.serverTimestamp(),
    },
    fields: record.fields,
  };

  if (vectorText?.length) {
    document.vector_text = FieldValue.vector(vectorText);
  }

  if (vectorImage?.length) {
    document.vector_image = FieldValue.vector(vectorImage);
  }

  return document;
}

function isWithinRecentImageEmbeddingWindow(recordAlertDate: Date, now = new Date()): boolean {
  const cutoffDate = new Date(now);
  cutoffDate.setDate(cutoffDate.getDate() - SAFETY_GATE_CONFIG.recentImageEmbeddingDays);
  return recordAlertDate >= cutoffDate;
}

function buildAlertImageDocId(alertId: string, imageUrl: string): string {
  const suffix = createHash("sha1").update(imageUrl).digest("hex").slice(0, 24);
  return `${alertId}__${suffix}`;
}

function buildAlertImageDocument(
  record: RapexRecord,
  recordAlertDate: Date,
  imageEmbedding: ImageEmbeddingPayload,
): RapexAlertImageDocument {
  return {
    alertId: record.recordid,
    imageUrl: imageEmbedding.url,
    imageIndex: imageEmbedding.imageIndex,
    meta: {
      datasetid: record.datasetid,
      recordid: record.recordid,
      record_timestamp: record.record_timestamp,
      alert_date: Timestamp.fromDate(recordAlertDate),
      ingested_at: FieldValue.serverTimestamp(),
    },
    fields: record.fields,
    vector_image: FieldValue.vector(imageEmbedding.vector),
    updatedAt: FieldValue.serverTimestamp(),
  };
}

function hasStoredVectorField(
  data: Record<string, unknown>,
  fieldName: "vector_text" | "vector_image",
): boolean {
  return Object.prototype.hasOwnProperty.call(data, fieldName) && data[fieldName] != null;
}

function updateNewestCheckpoint(progress: LoaderProgress, recordAlertDate: Date, recordTimestamp: string) {
  if (recordAlertDate.getTime() > progress.newestAlertDate.getTime()) {
    progress.newestAlertDate = recordAlertDate;
    progress.newestRecordTimestamp = recordTimestamp;
    return;
  }

  if (
    recordAlertDate.getTime() === progress.newestAlertDate.getTime() &&
    recordTimestamp > progress.newestRecordTimestamp
  ) {
    progress.newestRecordTimestamp = recordTimestamp;
  }
}

async function createImageEmbeddingsForRecord(
  record: RapexRecord,
  recordAlertDate: Date,
  existingImageDocIds: Set<string>,
): Promise<ImageEmbeddingPayload[]> {
  if (!isWithinRecentImageEmbeddingWindow(recordAlertDate)) {
    return [];
  }

  const pictureUrls = getPictureUrls(record.fields);
  if (pictureUrls.length === 0) {
    return [];
  }

  const embeddedImages = await Promise.all(
    pictureUrls.map(async (url, imageIndex) => {
      const docId = buildAlertImageDocId(record.recordid, url);
      if (existingImageDocIds.has(docId)) {
        return null;
      }

      const vector = await embedImage(url);
      if (!vector?.length) {
        return null;
      }

      return {
        url,
        imageIndex,
        vector,
      } satisfies ImageEmbeddingPayload;
    }),
  );

  return embeddedImages.filter((image): image is ImageEmbeddingPayload => image !== null);
}

async function enrichRecord(record: RapexRecord): Promise<{
  document: RapexAlertDocument;
  recordAlertDate: Date;
  imageEmbeddings: ImageEmbeddingPayload[];
  existingState: ExistingAlertEmbeddingState;
}> {
  const recordAlertDate = new Date(record.fields.alert_date);
  const existingState = await getExistingAlertEmbeddingState(record.recordid);
  const [vectorText, imageEmbeddings] = await Promise.all([
    existingState.hasTextVector ? Promise.resolve(undefined) : embedText(record.fields?.product_description || ""),
    createImageEmbeddingsForRecord(record, recordAlertDate, existingState.existingImageDocIds),
  ]);

  return {
    document: buildAlertDocument(
      record,
      recordAlertDate,
      vectorText,
      existingState.hasPrimaryImageVector ? undefined : imageEmbeddings[0]?.vector,
    ),
    recordAlertDate,
    imageEmbeddings,
    existingState,
  };
}

async function writeMissingAlertImageEmbeddings(
  record: RapexRecord,
  recordAlertDate: Date,
  imageEmbeddings: ImageEmbeddingPayload[],
  bulkWriter: ReturnType<typeof db.bulkWriter>,
): Promise<{ written: number }> {
  if (!isWithinRecentImageEmbeddingWindow(recordAlertDate)) {
    return { written: 0 };
  }

  const imageCollection = db.collection(FIRESTORE_COLLECTIONS.alertImages);
  let written = 0;
  for (const imageEmbedding of imageEmbeddings) {
    const docId = buildAlertImageDocId(record.recordid, imageEmbedding.url);
    bulkWriter.set(
      imageCollection.doc(docId),
      buildAlertImageDocument(record, recordAlertDate, imageEmbedding),
      { merge: true },
    );
    written += 1;
  }

  return { written };
}

async function processRecordsPage(
  records: RapexRecord[],
  lastState: LoaderState,
  progress: LoaderProgress,
  bulkWriter: ReturnType<typeof db.bulkWriter>,
): Promise<void> {
  logger.info(`Processing ${records.length} Safety Gate records from page ${progress.currentPage + 1}`);

  for (const record of records) {
    if (shouldStopOnOlderRecord(record, lastState)) {
      progress.hasMore = false;
      break;
    }

    if (shouldSkipAlreadyProcessedRecord(record, lastState)) {
      continue;
    }

    const { document, recordAlertDate, imageEmbeddings, existingState } = await enrichRecord(record);
    const documentRef = db.collection(FIRESTORE_COLLECTIONS.alerts).doc(record.recordid);

    bulkWriter.set(documentRef, document, { merge: true });
    const imageSync = await writeMissingAlertImageEmbeddings(record, recordAlertDate, imageEmbeddings, bulkWriter);
    progress.totalProcessed += 1;
    updateNewestCheckpoint(progress, recordAlertDate, record.record_timestamp);

    logger.debug("Processed Safety Gate alert embeddings", {
      alertId: record.recordid,
      textEmbedded: !existingState.hasTextVector && Boolean(document.vector_text),
      primaryImageEmbedded: !existingState.hasPrimaryImageVector && Boolean(document.vector_image),
      imageEmbeddingsWritten: imageSync.written,
    });

    if (progress.totalProcessed % 25 === 0) {
      logger.info("Safety Gate delta loader progress", {
        processed: progress.totalProcessed,
        currentPage: progress.currentPage + 1,
        lastAlertId: record.recordid,
      });
    }
  }
}

async function markRunStarted(runStartTime: Timestamp): Promise<LoaderState> {
  const stateRef = getLoaderStateRef();

  await stateRef.set(
    {
      last_run_start: runStartTime,
      last_run_status: "IN_PROGRESS",
    },
    { merge: true },
  );

  const stateDoc = await stateRef.get();
  return (
    (stateDoc.data() as LoaderState) || {
      last_alert_date: null,
      last_record_timestamp: null,
      last_run_start: null,
      last_run_end: null,
      last_run_status: "IN_PROGRESS",
    }
  );
}

async function markRunCompleted(progress: LoaderProgress): Promise<void> {
  const stateRef = getLoaderStateRef();
  const finalState: Partial<LoaderState> = {
    last_run_end: Timestamp.now(),
    last_run_status: "SUCCESS",
    last_run_processed_records: progress.totalProcessed,
  };

  if (progress.totalProcessed > 0) {
    finalState.last_alert_date = Timestamp.fromDate(progress.newestAlertDate);
    finalState.last_record_timestamp = progress.newestRecordTimestamp;
  }

  await stateRef.set(finalState, { merge: true });
  logger.info("Job finished successfully.", { finalState });
}

async function markRunFailed(): Promise<void> {
  const stateRef = getLoaderStateRef();
  await stateRef.set(
    {
      last_run_end: Timestamp.now(),
      last_run_status: "FAILURE",
    },
    { merge: true },
  );
}

export async function runSafetyGateLoader(): Promise<void> {
  const runStartTime = Timestamp.now();
  const lastState = await markRunStarted(runStartTime);
  const queryFilter = buildQueryFilter(lastState.last_alert_date);
  const bulkWriter = db.bulkWriter();
  const progress: LoaderProgress = {
    totalProcessed: 0,
    currentPage: 0,
    hasMore: true,
    newestAlertDate: lastState.last_alert_date ? lastState.last_alert_date.toDate() : new Date(0),
    newestRecordTimestamp: lastState.last_record_timestamp || "",
  };

  try {
    while (progress.hasMore && progress.currentPage < SAFETY_GATE_CONFIG.maxPages) {
      const start = progress.currentPage * SAFETY_GATE_CONFIG.rowsPerPage;
      const requestParams = buildLoaderRequestParams(start, queryFilter);

      logger.info(`Fetching page ${progress.currentPage + 1} with enhanced parameters`, {
        start,
        rows: SAFETY_GATE_CONFIG.rowsPerPage,
        queryFilter,
        facets: SAFETY_GATE_CONFIG.facets.length,
      });

      const { data } = await fetchOpenDataSoftRecords(
        requestParams,
        SAFETY_GATE_HEADERS.loaderUserAgent,
        SAFETY_GATE_CONFIG.requestTimeoutMs,
      );
      const records = data.records || [];

      logger.info(`OpenDataSoft API Response for page ${progress.currentPage + 1}:`, {
        totalRecords: records.length,
        hasFacets: Boolean(data.facet_groups),
        facetsCount: data.facet_groups?.length || 0,
        datasetId: SAFETY_GATE_CONFIG.dataset,
        apiUrl: SAFETY_GATE_CONFIG.baseUrl,
      });

      if (records.length === 0) {
        logger.info(`No more records found on page ${progress.currentPage + 1}. Stopping pagination.`);
        progress.hasMore = false;
        continue;
      }

      validateRecords(records);
      await processRecordsPage(records, lastState, progress, bulkWriter);
      progress.currentPage += 1;
    }

    await bulkWriter.close();
    logger.info(`Successfully processed and upserted ${progress.totalProcessed} records.`);
    await markRunCompleted(progress);
  } catch (error) {
    logger.error("Error running Safety Gate delta loader job.", { error });
    await markRunFailed();
    throw error;
  }
}

export async function backfillRecentAlertEmbeddings(params?: {
  days?: number;
  limit?: number;
}): Promise<{
  days: number;
  alertsScanned: number;
  alertsUpdated: number;
  textEmbeddingsWritten: number;
  imageDocumentsWritten: number;
}> {
  const days = Number.isFinite(params?.days) && (params?.days as number) > 0
    ? Math.floor(params?.days as number)
    : SAFETY_GATE_CONFIG.recentImageEmbeddingDays;
  const limit = Number.isFinite(params?.limit) && (params?.limit as number) > 0
    ? Math.floor(params?.limit as number)
    : undefined;
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);

  let query = db
    .collection(FIRESTORE_COLLECTIONS.alerts)
    .where("meta.alert_date", ">=", Timestamp.fromDate(cutoffDate))
    .orderBy("meta.alert_date", "desc");

  if (limit) {
    query = query.limit(limit);
  }

  const snapshot = await query.get();
  const orderedDocs = [...snapshot.docs].sort((leftDoc, rightDoc) => {
    const leftData = leftDoc.data() as {
      meta?: Partial<RapexAlertDocument["meta"]>;
    };
    const rightData = rightDoc.data() as {
      meta?: Partial<RapexAlertDocument["meta"]>;
    };
    const leftMeta: Partial<RapexAlertDocument["meta"]> = leftData.meta || {};
    const rightMeta: Partial<RapexAlertDocument["meta"]> = rightData.meta || {};
    const leftAlertDate =
      leftMeta.alert_date && typeof (leftMeta.alert_date as Timestamp).toDate === "function"
        ? (leftMeta.alert_date as Timestamp).toDate().getTime()
        : new Date(String(leftMeta.alert_date || 0)).getTime();
    const rightAlertDate =
      rightMeta.alert_date && typeof (rightMeta.alert_date as Timestamp).toDate === "function"
        ? (rightMeta.alert_date as Timestamp).toDate().getTime()
        : new Date(String(rightMeta.alert_date || 0)).getTime();

    if (leftAlertDate !== rightAlertDate) {
      return rightAlertDate - leftAlertDate;
    }

    const leftRecordTimestamp = String(leftMeta.record_timestamp || "");
    const rightRecordTimestamp = String(rightMeta.record_timestamp || "");
    if (leftRecordTimestamp !== rightRecordTimestamp) {
      return rightRecordTimestamp.localeCompare(leftRecordTimestamp);
    }

    const leftRecordId = String(leftMeta.recordid || leftDoc.id);
    const rightRecordId = String(rightMeta.recordid || rightDoc.id);
    return rightRecordId.localeCompare(leftRecordId);
  });
  const recentImageDocIdsByAlertId = await loadRecentAlertImageDocIdsByAlertId(cutoffDate);
  logger.info("Starting recent Safety Gate embedding backfill", {
    days,
    totalAlertsInScope: orderedDocs.length,
    recentAlertImageDocsTracked: Array.from(recentImageDocIdsByAlertId.values()).reduce(
      (count, docIds) => count + docIds.size,
      0,
    ),
    limit: limit || null,
    newestAlertId: (() => {
      const firstData = orderedDocs[0]?.data() as { meta?: Partial<RapexAlertDocument["meta"]> } | undefined;
      return String(firstData?.meta?.recordid || orderedDocs[0]?.id || "");
    })(),
    oldestAlertId: (() => {
      const lastData = orderedDocs.at(-1)?.data() as { meta?: Partial<RapexAlertDocument["meta"]> } | undefined;
      return String(lastData?.meta?.recordid || orderedDocs.at(-1)?.id || "");
    })(),
  });
  const bulkWriter = db.bulkWriter();
  let alertsUpdated = 0;
  let textEmbeddingsWritten = 0;
  let imageDocumentsWritten = 0;
  let processed = 0;

  for (const doc of orderedDocs) {
    processed += 1;
    const data = doc.data() as Record<string, unknown> & Partial<RapexAlertDocument> & {
      meta?: Partial<RapexAlertDocument["meta"]>;
      fields?: RapexRecord["fields"];
    };
    const meta: Partial<RapexAlertDocument["meta"]> = data.meta || {};
    const alertDate =
      meta.alert_date && typeof (meta.alert_date as Timestamp).toDate === "function"
        ? (meta.alert_date as Timestamp).toDate()
        : new Date(String(meta.alert_date || ""));

    if (Number.isNaN(alertDate.getTime())) {
      continue;
    }

    const record: RapexRecord = {
      datasetid: String(meta.datasetid || SAFETY_GATE_CONFIG.dataset),
      recordid: String(meta.recordid || doc.id),
      record_timestamp: String(meta.record_timestamp || ""),
      fields: (data.fields || {}) as RapexRecord["fields"],
    };
    const existingImageDocIds = recentImageDocIdsByAlertId.get(record.recordid) ?? new Set<string>();
    const needsTextVector = !hasStoredVectorField(data, "vector_text");
    const textEmbedding = needsTextVector
      ? await embedText(record.fields?.product_description || "")
      : undefined;
    const imageEmbeddings = await createImageEmbeddingsForRecord(
      record,
      alertDate,
      existingImageDocIds,
    );
    const imageSync = await writeMissingAlertImageEmbeddings(record, alertDate, imageEmbeddings, bulkWriter);
    const hasPrimaryImageVector = hasStoredVectorField(data, "vector_image");
    const updatePayload: Record<string, unknown> = {};

    if (textEmbedding?.length) {
      updatePayload.vector_text = FieldValue.vector(textEmbedding);
      textEmbeddingsWritten += 1;
    }

    if (!hasPrimaryImageVector && imageEmbeddings[0]?.vector?.length) {
      updatePayload.vector_image = FieldValue.vector(imageEmbeddings[0].vector);
    }

    if (Object.keys(updatePayload).length > 0) {
      bulkWriter.set(doc.ref, updatePayload, { merge: true });
    }

    if (imageSync.written > 0 || Object.keys(updatePayload).length > 0) {
      alertsUpdated += 1;
      imageDocumentsWritten += imageSync.written;
      if (imageSync.written > 0) {
        const tracked = recentImageDocIdsByAlertId.get(record.recordid) ?? new Set<string>();
        for (const imageEmbedding of imageEmbeddings) {
          tracked.add(buildAlertImageDocId(record.recordid, imageEmbedding.url));
        }
        recentImageDocIdsByAlertId.set(record.recordid, tracked);
      }
    }

    if (processed % 25 === 0) {
      logger.info("Recent Safety Gate embedding backfill progress", {
        processed,
        total: orderedDocs.length,
        alertsUpdated,
        textEmbeddingsWritten,
        imageDocumentsWritten,
        lastAlertId: record.recordid,
      });
    }
  }

  await bulkWriter.close();

  const summary = {
    days,
    alertsScanned: orderedDocs.length,
    alertsUpdated,
    textEmbeddingsWritten,
    imageDocumentsWritten,
  };

  logger.info("Recent Safety Gate embedding backfill completed.", summary);
  return summary;
}
