import { firestore } from "../firestore.server";
import { summarizeMonitoringActivity, summarizeMonitoringRun, type MonitoringRunSummary } from "./monitoring-runs";

export async function getMonitoringActivity(shop: string, observedAt: number, baselineAt: string | null) {
  if (!baselineAt) return null;
  const since = Math.max(Date.parse(baselineAt), observedAt - 30 * 24 * 60 * 60_000);
  const snapshot = await firestore.collection("merchants").doc(encodeURIComponent(shop.trim()))
    .collection("monitoring_runs")
    .where("updatedAt", ">", new Date(since))
    .where("updatedAt", "<=", new Date(observedAt))
    .orderBy("updatedAt", "desc")
    .select("status", "result.rapexAlertsScanned", "completedSummary.rapexAlertsScanned",
      "rapexAlertsScanned", "completedAt", "updatedAt")
    .limit(101)
    .get();
  return summarizeMonitoringActivity(snapshot.docs.map(doc => doc.data()), since);
}

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
