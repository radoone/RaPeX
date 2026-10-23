export type ReviewFilters = { from: string; to: string; status: string };
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
    status: ["active", "resolved", "dismissed"].includes(status) ? status : "",
  };
}

export function matchesReviewFilters(
  record: { status: string; createdAt?: Date | string | null },
  filters: ReviewFilters,
) {
  const timestamp = record.createdAt ? new Date(record.createdAt) : null;
  const day =
    timestamp && Number.isFinite(timestamp.getTime())
      ? timestamp.toISOString().slice(0, 10)
      : "";
  return (
    (!filters.status || record.status === filters.status) &&
    (!filters.from || day >= filters.from) &&
    (!filters.to || day <= filters.to)
  );
}
