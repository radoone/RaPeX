import { FieldValue } from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";
import { db } from "./firebase-admin.js";
import { FIRESTORE_COLLECTIONS } from "./safety-gate-config.js";
import { embedImage, embedText, getFirstPicture } from "./safety-gate-embeddings.js";

type BackfillItemResult = {
  recordid: string;
  vectorTextWritten: boolean;
  vectorImageWritten: boolean;
  error?: string;
};

type BackfillSummary = {
  requestedLimit: number;
  selectedCount: number;
  updatedCount: number;
  failedCount: number;
  results: BackfillItemResult[];
};

const DEFAULT_LOOKAHEAD_LIMIT = 100;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function parseRecordTimestamp(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function hasProductImage(fields: Record<string, unknown> | null | undefined): boolean {
  return isNonEmptyString(getFirstPicture(fields));
}

export async function backfillLatestRapexEmbeddings(limit = 20): Promise<BackfillSummary> {
  const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.min(Math.floor(limit), 100) : 20;
  const lookAheadLimit = Math.max(DEFAULT_LOOKAHEAD_LIMIT, safeLimit * 5);

  const snapshot = await db
    .collection(FIRESTORE_COLLECTIONS.alerts)
    .orderBy("meta.record_timestamp", "desc")
    .limit(lookAheadLimit)
    .get();

  const selectedDocs = snapshot.docs
    .filter((doc) => hasProductImage((doc.data() as any)?.fields))
    .slice(0, safeLimit);

  const results: BackfillItemResult[] = [];
  let updatedCount = 0;

  for (const doc of selectedDocs) {
    const data = doc.data() as any;
    const fields = data?.fields || {};
    const recordid = String(data?.meta?.recordid || doc.id);
    const productDescription = typeof fields.product_description === "string" ? fields.product_description : "";
    const firstPicture = getFirstPicture(fields);

    try {
      const [vectorText, vectorImage] = await Promise.all([
        embedText(productDescription),
        firstPicture ? embedImage(firstPicture) : Promise.resolve(undefined),
      ]);

      const updatePayload: Record<string, unknown> = {};

      if (vectorText?.length) {
        updatePayload.vector_text = FieldValue.vector(vectorText);
      }

      if (vectorImage?.length) {
        updatePayload.vector_image = FieldValue.vector(vectorImage);
      }

      if (Object.keys(updatePayload).length === 0) {
        const result = {
          recordid,
          vectorTextWritten: false,
          vectorImageWritten: false,
          error: "No embeddings generated",
        };
        results.push(result);
        logger.warn("Backfill produced no embeddings", result);
        continue;
      }

      await doc.ref.set(updatePayload, { merge: true });

      const result = {
        recordid,
        vectorTextWritten: Boolean(updatePayload.vector_text),
        vectorImageWritten: Boolean(updatePayload.vector_image),
      };
      results.push(result);
      updatedCount += 1;
      logger.info("Backfill updated RAPEX embeddings", {
        ...result,
        recordTimestamp: parseRecordTimestamp(data?.meta?.record_timestamp),
      });
    } catch (error) {
      const result = {
        recordid,
        vectorTextWritten: false,
        vectorImageWritten: false,
        error: error instanceof Error ? error.message : String(error),
      };
      results.push(result);
      logger.error("Backfill failed for RAPEX document", result);
    }
  }

  return {
    requestedLimit: safeLimit,
    selectedCount: selectedDocs.length,
    updatedCount,
    failedCount: results.filter((entry) => entry.error).length,
    results,
  };
}
