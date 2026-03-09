import axios from "axios";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";
import { db } from "./firebase-admin.js";
import {
  FIRESTORE_COLLECTIONS,
  SAFETY_GATE_CONFIG,
  SAFETY_GATE_HEADERS,
} from "./safety-gate-config.js";
import { embedImage, embedText, getFirstPicture } from "./safety-gate-embeddings.js";
import type {
  LoaderState,
  OpenDataSoftResponse,
  RapexAlertDocument,
  RapexRecord,
} from "./safety-gate-types.js";

type LoaderProgress = {
  totalProcessed: number;
  currentPage: number;
  hasMore: boolean;
  newestAlertDate: Date;
  newestRecordTimestamp: string;
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

function parseQueryValue(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    const first = value[0];
    return typeof first === "string" && first.trim() ? first.trim() : undefined;
  }

  return typeof value === "string" && value.trim() ? value.trim() : undefined;
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
    document.vector_text = vectorText;
  }

  if (vectorImage?.length) {
    document.vector_image = vectorImage;
  }

  return document;
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

async function enrichRecord(record: RapexRecord): Promise<RapexAlertDocument> {
  const recordAlertDate = new Date(record.fields.alert_date);
  const [vectorText, vectorImage] = await Promise.all([
    embedText(record.fields?.product_description || ""),
    (async () => {
      const primaryImageUrl = getFirstPicture(record.fields);
      return primaryImageUrl ? embedImage(primaryImageUrl) : undefined;
    })(),
  ]);

  return buildAlertDocument(record, recordAlertDate, vectorText, vectorImage);
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

    const recordAlertDate = new Date(record.fields.alert_date);
    const document = await enrichRecord(record);
    const documentRef = db.collection(FIRESTORE_COLLECTIONS.alerts).doc(record.recordid);

    bulkWriter.set(documentRef, document, { merge: true });
    progress.totalProcessed += 1;
    updateNewestCheckpoint(progress, recordAlertDate, record.record_timestamp);
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

export async function runOpenDataSoftApiTest(query: Record<string, unknown>) {
  const filters: string[] = [];
  const category = parseQueryValue(query.category);
  const country = parseQueryValue(query.country);
  const risk = parseQueryValue(query.risk);

  if (category) {
    filters.push(`product_category:"${category}"`);
  }

  if (country) {
    filters.push(`alert_country:"${country}"`);
  }

  if (risk) {
    filters.push(`risk_level:"${risk}"`);
  }

  const testParams: Record<string, unknown> = {
    dataset: SAFETY_GATE_CONFIG.dataset,
    rows: 1,
    sort: SAFETY_GATE_CONFIG.defaultSort,
  };

  if (filters.length > 0) {
    testParams.q = filters.join(" AND ");
  }

  const { data, status } = await fetchOpenDataSoftRecords(
    testParams,
    SAFETY_GATE_HEADERS.testUserAgent,
    SAFETY_GATE_CONFIG.testRequestTimeoutMs,
  );

  return {
    success: true,
    api: {
      endpoint: SAFETY_GATE_CONFIG.baseUrl,
      dataset: SAFETY_GATE_CONFIG.dataset,
      parameters: testParams,
    },
    response: {
      status,
      totalRecords: data.nhits || 0,
      recordsReturned: data.records?.length || 0,
      facetsAvailable: data.facet_groups?.length || 0,
    },
    sampleRecord: data.records?.[0] || null,
    timestamp: new Date().toISOString(),
  };
}
