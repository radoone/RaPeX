import { firestore } from "../firestore.server";
import { summarizeMonitoringRun, type MonitoringRunSummary } from "./monitoring-runs";

export async function getRecentMonitoringRuns(shop: string, limit = 3): Promise<MonitoringRunSummary[]> {
  const safeLimit = Math.min(5, Math.max(1, Math.floor(limit)));
  const snapshot = await firestore
    .collection("merchants")
    .doc(encodeURIComponent(shop.trim()))
    .collection("monitoring_runs")
    .orderBy("updatedAt", "desc")
    .limit(safeLimit)
    .get();

  return snapshot.docs.map((document) => summarizeMonitoringRun(document.id, document.data()));
}
