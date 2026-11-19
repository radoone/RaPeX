import { isWaitingForSupplier } from "./review-evidence";

export type ReviewFilters = { from: string; to: string; status: string; dateBasis?: "findings" | "decisions"; query?: string; timeZone?: string };
export function reviewFilters(url: URL): ReviewFilters {
  const date = (key: string) => {
    const value = url.searchParams.get(key) || "";
    return /^\d{4}-\d{2}-\d{2}$/.test(value) &&
      Number.isFinite(Date.parse(value)) &&
      new Date(value).toISOString().slice(0, 10) === value
      ? value
      : "";
  };
  const status = url.searchParams.get("status") || "";
  return {
    from: date("from"),
    to: date("to"),
    status: ["active", "needs_review", "waiting_for_supplier", "closed", "resolved", "dismissed"].includes(status) ? status : "",
    dateBasis: url.searchParams.get("dateBasis") === "decisions" ? "decisions" as const : "findings" as const,
    query: (url.searchParams.get("q") || "").trim().slice(0, 200),
    timeZone: validTimeZone(url.searchParams.get("timeZone") || "Europe/Bratislava"),
  };
}

function validTimeZone(value: string): string {
  try { new Intl.DateTimeFormat("en", { timeZone: value }); return value; }
  catch { return "Europe/Bratislava"; }
}

export function matchesReviewDate(value: Date | string | null | undefined, filters: ReviewFilters) {
  if (!filters.from && !filters.to) return true;
  const date = value ? new Date(value) : null;
  if (!date || !Number.isFinite(date.getTime())) return false;
  const parts = new Intl.DateTimeFormat("en", { timeZone: validTimeZone(filters.timeZone || "Europe/Bratislava"), year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const part = (name: string) => parts.find(p => p.type === name)?.value;
  const day = `${part("year")}-${part("month")}-${part("day")}`;
  return (!filters.from || day >= filters.from) && (!filters.to || day <= filters.to);
}

export function matchesReviewSearch(record: Record<string, any>, query = "", event?: Record<string, any>) {
  return [record.productTitle, record.caseNumber, record.reason, record.notes, event?.notes, event?.actorId]
    .join(" ").toLocaleLowerCase().includes(query.toLocaleLowerCase());
}

export function selectedDecisionEvents(record: Record<string, any>, filters: ReviewFilters) {
  return (record.decisions || []).filter((event: any) => matchesReviewDate(event.createdAt, filters) && matchesReviewSearch(record, filters.query, event));
}

type ReviewStatus = {
  status: string;
  reviewState?: string;
  resolutionType?: string | null;
};

function isClosed(record: ReviewStatus): boolean {
  return record.status === "resolved" || record.status === "dismissed";
}

export function summarizeReviewStatuses(records: ReviewStatus[]) {
  const summary = { needsReview: 0, waiting: 0, closed: 0 };
  for (const record of records) {
    if (isClosed(record)) summary.closed++;
    else if (isWaitingForSupplier(record)) summary.waiting++;
    else if (record.status === "active") summary.needsReview++;
  }
  return summary;
}

export function matchesReviewFilters(
  record: ReviewStatus & { createdAt?: Date | string | null },
  filters: ReviewFilters,
) {
  const statusMatches = !filters.status || filters.status === record.status ||
    (filters.status === "closed" && isClosed(record)) ||
    (filters.status === "waiting_for_supplier" && isWaitingForSupplier(record)) ||
    (filters.status === "needs_review" && record.status === "active" && !isWaitingForSupplier(record));
  return statusMatches && matchesReviewDate(record.createdAt, filters);
}
