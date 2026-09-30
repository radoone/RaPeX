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
