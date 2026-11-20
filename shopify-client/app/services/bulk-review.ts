export type BulkReviewOutcome =
  | "match_not_confirmed"
  | "not_my_product"
  | "removed_from_sale"
  | "modified_product";

/** Only currently visible selections may become a shared review decision. */
export function prepareBulkReview(
  visible: readonly { id: string }[],
  selectedIds: readonly string[],
  outcome: string,
  notes: string,
) {
  if (!["match_not_confirmed", "not_my_product", "removed_from_sale", "modified_product"].includes(outcome)) return null;
  const selected = new Set(selectedIds);
  const ids = [...new Set(visible.filter(item => selected.has(item.id)).map(item => item.id))];
  if (!ids.length) return null;
  return {
    ids,
    action: outcome === "not_my_product" ? "dismiss" as const : "resolve" as const,
    outcome: outcome as BulkReviewOutcome,
    notes: notes.trim() || undefined,
  };
}
