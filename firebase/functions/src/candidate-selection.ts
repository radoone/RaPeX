import { MATCHING_THRESHOLDS, RAG_CANDIDATE_LIMITS } from "./safety-gate-config.js";
import type { NormalizedAlert } from "./safety-gate-checker.types.js";

/** Global current-state shortlist. Exact identifiers bypass the AI budget.
 * Rank each modality separately: text and image distances are not interchangeable,
 * and a translated/rebranded listing must retain its independent image route.
 */
export function selectRagCandidates(candidates: NormalizedAlert[], exactIds = new Set<string>()): NormalizedAlert[] {
  const unique = new Map<string, NormalizedAlert>();
  for (const candidate of candidates) {
    const previous = unique.get(candidate.id);
    if (!previous) { unique.set(candidate.id, candidate); continue; }
    const minimum = (a?: number, b?: number) => {
      const values = [a, b].filter((n): n is number => typeof n === "number" && Number.isFinite(n));
      return values.length ? Math.min(...values) : undefined;
    };
    unique.set(candidate.id, { ...previous,
      textDistance: minimum(previous.textDistance, candidate.textDistance),
      imageDistance: minimum(previous.imageDistance, candidate.imageDistance),
      matchedImageUrls: [...new Set([...(previous.matchedImageUrls || []), ...(candidate.matchedImageUrls || [])])],
    });
  }
  const rows = [...unique.values()];
  const ranked = (field: "textDistance" | "imageDistance", threshold: number, limit: number) => rows
    .filter(row => !exactIds.has(row.id) && typeof row[field] === "number" && Number.isFinite(row[field]) && row[field]! <= threshold)
    .sort((a, b) => a[field]! - b[field]! || a.id.localeCompare(b.id)).slice(0, limit);
  for (const row of rows) {
    if (!exactIds.has(row.id) && !Number.isFinite(row.textDistance) && !Number.isFinite(row.imageDistance)) {
      throw new Error("Safety Gate candidate has no vector distance");
    }
  }
  const selected = [...rows.filter(row => exactIds.has(row.id)),
    ...ranked("imageDistance", MATCHING_THRESHOLDS.imageDistance, RAG_CANDIDATE_LIMITS.image),
    ...ranked("textDistance", MATCHING_THRESHOLDS.textDistance, RAG_CANDIDATE_LIMITS.text)];
  return [...new Map(selected.map(row => [row.id, row])).values()];
}
