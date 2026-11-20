import { isWaitingForSupplier } from "./review-evidence";

export type CatalogCheckFilter = "all" | "pending" | "current";
export type CatalogFindingFilter = "all" | "active" | "waiting" | "closed";

/** Check freshness and saved finding workflow are independent product attributes. */
export function matchesCatalogFilters(
  state: string | undefined,
  finding: { status?: string; reviewState?: string; resolutionType?: string | null } | undefined,
  checkFilter: CatalogCheckFilter,
  findingFilter: CatalogFindingFilter,
) {
  if (checkFilter === "pending" && state === "current") return false;
  if (checkFilter === "current" && state !== "current") return false;
  if (findingFilter === "all") return true;
  if (findingFilter === "waiting") return Boolean(finding && isWaitingForSupplier(finding));
  if (findingFilter === "active") return finding?.status === "active" && !isWaitingForSupplier(finding);
  return finding?.status === "resolved" || finding?.status === "dismissed";
}
