/** Ignore delayed update webhooks that predate a product's deletion event. */
export function isProductChangeSupersededByDeletion(
  deletedAt: unknown,
  deletedSourceUpdatedAt: unknown,
  sourceUpdatedAt: string,
): boolean {
  if (!deletedAt || typeof deletedSourceUpdatedAt !== "string") return false;
  const deletedVersion = Date.parse(deletedSourceUpdatedAt);
  const incomingVersion = Date.parse(sourceUpdatedAt);
  return Number.isFinite(deletedVersion) && Number.isFinite(incomingVersion) && incomingVersion <= deletedVersion;
}

/** Recheck at commit time, after external model/embedding calls have finished. */
export function canApplyProductVersion(data: Record<string, unknown>, incoming: string): boolean {
  if (!Number.isFinite(Date.parse(incoming))) return false;
  if (typeof data.sourceUpdatedAt === "string" && Date.parse(data.sourceUpdatedAt) > Date.parse(incoming)) return false;
  return !isProductChangeSupersededByDeletion(data.deletedAt, data.deletedSourceUpdatedAt, incoming);
}

export function installationKey(data: Record<string, unknown>): string {
  if (data.installationRetiredAt) return "retired";
  const created = data.createdAt as { toMillis?: () => number } | undefined;
  return created?.toMillis ? String(created.toMillis()) : String(data.createdAt || "legacy");
}
/** REST webhooks and GraphQL can encode the same Shopify version with different offsets. */
export function sameProductVersion(left: unknown, right: unknown): boolean {
  const first = typeof left === "string" ? Date.parse(left) : NaN;
  const second = typeof right === "string" ? Date.parse(right) : NaN;
  return Number.isFinite(first) && first === second;
}

