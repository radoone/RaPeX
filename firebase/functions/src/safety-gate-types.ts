import type { FieldValue, Timestamp } from "firebase-admin/firestore";

export interface LoaderState {
  last_alert_date: Timestamp | null;
  last_record_timestamp: string | null;
  last_run_start: Timestamp | null;
  last_run_end: Timestamp | null;
  last_run_status: "SUCCESS" | "FAILURE" | "IN_PROGRESS";
  last_run_processed_records?: number;
}

export interface RapexRecordFields {
  [key: string]: any;
  alert_date: string;
}

export interface RapexRecord {
  datasetid: string;
  recordid: string;
  fields: RapexRecordFields;
  record_timestamp: string;
}

export interface RapexAlertDocument {
  meta: {
    datasetid: string;
    recordid: string;
    record_timestamp: string;
    alert_date: Timestamp;
    ingested_at: FieldValue;
  };
  fields: RapexRecordFields;
  vector_text?: number[];
  vector_image?: number[];
}

export interface OpenDataSoftResponse {
  records: RapexRecord[];
  nhits?: number;
  facet_groups?: unknown[];
}

export interface ProductCheckInput {
  name: string;
  category: string;
  description: string;
  imageUrl?: string;
  imageUrls?: string[];
  brand?: string;
  model?: string;
}
