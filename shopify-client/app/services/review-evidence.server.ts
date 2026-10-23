import { firestore } from "../firestore.server";
import { officialSource } from "./review-evidence";
/** Fill missing public references from the actual imported record, without changing stored decisions or matcher facts. */
export async function withOfficialReferences<
  T extends { checkResult?: string | null },
>(alerts: T[]): Promise<T[]> {
  const parsed = alerts.map((alert) => {
    try {
      return alert.checkResult ? JSON.parse(alert.checkResult) : null;
    } catch {
      return null;
    }
  });
  const ids = [
    ...new Set<string>(
      parsed.flatMap((result) =>
        (Array.isArray(result?.warnings) ? result.warnings : [])
          .map((w: any) => w?.alertId)
          .filter(
            (id: unknown) =>
              typeof id === "string" &&
              id.length > 0 &&
              id.length < 500 &&
              !id.includes("/"),
          ),
      ),
    ),
  ];
  const sourceById = new Map<string, Record<string, any>>();
  try {
    for (let offset = 0; offset < ids.length; offset += 100) {
      const docs = await firestore.getAll(
        ...ids
          .slice(offset, offset + 100)
          .map((id) => firestore.collection("rapex_alerts").doc(id)),
      );
      docs.forEach((doc) => {
        if (doc.exists)
          sourceById.set(doc.id, doc.data()?.fields || doc.data() || {});
      });
    }
  } catch {
    console.warn(
      "Official source references unavailable; preserving saved evidence",
    );
  }
  return alerts.map((alert, index) => {
    const result = parsed[index];
    if (!Array.isArray(result?.warnings)) return alert;
    for (const warning of result.warnings) {
      const original = sourceById.get(warning.alertId);
      if (!original) continue;
      const fields = { ...(warning.alertDetails?.fields || {}) };
      const savedSource = officialSource(fields);
      const source = officialSource(original);
      if (!savedSource.caseNumber && source.caseNumber)
        fields.caseNumber = source.caseNumber;
      if (!savedSource.url && source.url) fields.url = source.url;
      for (const key of [
        "barcode",
        "batchNumber",
        "type_numberOfModel",
      ] as const)
        if (!fields[key] && original[key]) fields[key] = original[key];
      warning.alertDetails = { ...warning.alertDetails, fields };
    }
    return { ...alert, checkResult: JSON.stringify(result) };
  });
}
