import { useTranslation } from "react-i18next";

export const reviewStatusOptions = [
  ["needs_review", "status.needsReview"],
  ["waiting_for_supplier", "workspace.waiting"],
  ["closed", "reviewOverview.closed"],
  ["active", "reviewOverview.open"],
  ["resolved", "status.resolved"],
  ["dismissed", "status.dismissed"],
] as const;

export function ReviewStatusSummary({
  title,
  counts,
}: {
  title: string;
  counts: { needsReview: number; waiting: number; closed: number };
}) {
  const { t } = useTranslation();
  return (
    <dl className="audit-report-summary review-status-summary" aria-label={title}>
      <div>
        <dt>{t("status.needsReview")}</dt>
        <dd>{counts.needsReview}</dd>
      </div>
      <div>
        <dt>{t("workspace.waiting")}</dt>
        <dd>{counts.waiting}</dd>
      </div>
      <div>
        <dt>{t("reviewOverview.closed")}</dt>
        <dd>{counts.closed}</dd>
      </div>
    </dl>
  );
}
