import { firestore } from "../firestore.server";
import { toIsoString } from "./monitoring-runs";

const knownStatuses = new Set(["completed", "scanning", "queued", "failed", "enqueue_failed", "SUCCESS", "FAILURE", "IN_PROGRESS"]);
function status(value: unknown): string | null {
  if (value === "processing" || value === "retrying") return "scanning";
  return typeof value === "string" && knownStatuses.has(value) ? value : null;
}
function endedAt(value: unknown, state: string | null): string | null {
  if (!["completed", "failed", "SUCCESS", "FAILURE"].includes(state || "")) return null;
  try { return toIsoString(value); } catch { return null; }
}

/** Current operational snapshot, independent of finding filters. Never a safety certificate. */
export async function monitoringEvidence(shop: string) {
  const merchant = firestore.collection("merchants").doc(encodeURIComponent(shop));
  const [merchantResult, sourceResult, runResult] = await Promise.allSettled([
    merchant.get(),
    firestore.doc("rapex_meta/loader_state").get(),
    merchant.collection("monitoring_runs").orderBy("updatedAt", "desc").limit(1).get(),
  ]);
  const m = merchantResult.status === "fulfilled" && merchantResult.value.exists ? merchantResult.value.data() : undefined;
  const s = sourceResult.status === "fulfilled" && sourceResult.value.exists ? sourceResult.value.data() : undefined;
  const run = runResult.status === "fulfilled" ? runResult.value.docs[0]?.data() : undefined;
  // An unreadable latest run must not fall back to an older success.
  const monitorStatus = runResult.status === "rejected" ? null : status(run ? run.status : m?.lastMonitorStatus);
  const sourceStatus = status(s?.last_run_status);
  const imported = m?.initialScanProductsImported;
  return {
    initialStatus: status(m?.initialScanStatus),
    importedProducts: typeof imported === "number" && Number.isSafeInteger(imported) && imported >= 0 ? imported : null,
    monitorStatus,
    monitorEndedAt: endedAt(run ? run.completedAt : m?.lastMonitorRunEnd, monitorStatus),
    sourceStatus,
    sourceEndedAt: endedAt(s?.last_run_end, sourceStatus),
  };
}
