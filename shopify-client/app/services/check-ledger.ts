import { sameProductVersion } from "./catalog-coverage";
import { toIsoString } from "./monitoring-runs";

export type LedgerState = "current" | "changed" | "unverified" | "unchecked" | "deleted";
export type LedgerRow = {
  id: string; title: string; productVersion: string | null; checkedVersion: string | null;
  checkedAt: string | null; coveredThrough: string | null; matcherPolicy: string | null;
  state: LedgerState; result: "noMatch" | "possibleMatch" | "unknown";
  evidence: "fullIndex" | "recordedCheck" | "none";
};

function installationKey(data: Record<string, any>): string {
  return data.installationRetiredAt ? "retired" : data.createdAt?.toMillis
    ? String(data.createdAt.toMillis()) : String(data.createdAt || "legacy");
}

/** Current means the recorded Shopify version, never an assertion about a live catalog or safety. */
export function ledgerRow(id: string, product: Record<string, any>, coverage: Record<string, any> | undefined,
  check: Record<string, any> | undefined, merchant: Record<string, any>): LedgerRow {
  let parsed: any;
  try { parsed = coverage?.resultJson ? JSON.parse(coverage.resultJson) : null; } catch { parsed = null; }
  const durable = !merchant.installationRetiredAt && coverage?.installation === installationKey(merchant) &&
    typeof parsed?.isSafe === "boolean" && toIsoString(coverage?.completedAt) && toIsoString(coverage?.coveredThrough);
  const fullCheck = durable ? { ...coverage, isSafe: parsed.isSafe, checkedAt: coverage?.completedAt } : undefined;
  const checkDate = toIsoString(check?.checkedAt);
  const installedAt = toIsoString(merchant.createdAt);
  const validCheck = !merchant.installationRetiredAt && checkDate && typeof check?.isSafe === "boolean" &&
    (!installedAt || Date.parse(checkDate) >= Date.parse(installedAt)) ? check : undefined;
  const candidates = [fullCheck, validCheck].filter((item): item is Record<string, any> => Boolean(item));
  candidates.sort((left, right) => {
    const leftCurrent = sameProductVersion(left.sourceUpdatedAt, product.sourceUpdatedAt);
    const rightCurrent = sameProductVersion(right.sourceUpdatedAt, product.sourceUpdatedAt);
    return Number(rightCurrent) - Number(leftCurrent) ||
      Date.parse(toIsoString(right.checkedAt)!) - Date.parse(toIsoString(left.checkedAt)!);
  });
  const saved = candidates[0];
  const usesFullCheck = saved === fullCheck && fullCheck !== undefined;
  const checkedVersion = toIsoString(saved?.sourceUpdatedAt);
  const productVersion = toIsoString(product.sourceUpdatedAt);
  const checkedAt = toIsoString(saved?.checkedAt);
  const hasResult = checkedAt !== null && typeof saved?.isSafe === "boolean";
  return {
    id, title: String(product.name || product.title || product.productTitle || id), productVersion, checkedVersion,
    checkedAt: hasResult ? checkedAt : null,
    coveredThrough: usesFullCheck ? toIsoString(coverage?.coveredThrough) : null,
    matcherPolicy: usesFullCheck && coverage?.matcherPolicy != null ? String(coverage.matcherPolicy) : null,
    state: product.deletedAt ? "deleted" : !hasResult ? "unchecked" : !checkedVersion || !productVersion ? "unverified"
      : sameProductVersion(checkedVersion, productVersion) ? "current" : "changed",
    result: hasResult ? saved?.isSafe ? "noMatch" : "possibleMatch" : "unknown",
    evidence: usesFullCheck ? "fullIndex" : hasResult ? "recordedCheck" : "none",
  };
}

export function ledgerFilters(url: URL) {
  const state = url.searchParams.get("checkState") || "";
  const cursor = url.searchParams.get("checkAfter") || "";
  if (cursor.length > 256 || cursor.includes("/") || [...cursor].some(char => char.charCodeAt(0) < 32)) {
    throw new Response("Invalid page cursor", { status: 400 });
  }
  return { state: ["current", "changed", "unverified", "unchecked", "deleted"].includes(state) ? state : "", cursor };
}
