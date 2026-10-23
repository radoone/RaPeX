import { LocalDateTime } from "../components/LocalDateTime";
import type { LoaderFunctionArgs } from "react-router";
import {
  Form,
  data as json,
  isRouteErrorResponse,
  useLoaderData,
  useNavigate,
  useRouteError,
} from "react-router";
import { useTranslation } from "react-i18next";
import { useEffect, useState } from "react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import {
  reviewRecords,
  reviewFilters,
} from "../services/review-records.server";
import { decisionKey, isWaitingForSupplier } from "../services/review-evidence";
import { localizeRisk } from "../components/AlertBadge";

export const headers = (headersArgs: any) => {
  return boundary.headers(headersArgs);
};

export const loader = async ({ request, url }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  return json(await reviewRecords(session.shop, reviewFilters(url), 100));
};

export default function AuditReportPage() {
  const { records, generatedAt, total, shop, filters, summary, scope } =
    useLoaderData<typeof loader>();
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [exporting, setExporting] = useState(false);
  const [exportFailed, setExportFailed] = useState(false);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  useEffect(
    () => () => {
      if (downloadUrl) URL.revokeObjectURL(downloadUrl);
    },
    [downloadUrl],
  );
  const { active, documented } = summary;
  const filterQuery = new URLSearchParams(
    Object.entries(filters).filter(([, value]) => value),
  ).toString();

  async function downloadReport() {
    if (exporting) return;
    setExporting(true);
    setExportFailed(false);
    try {
      // Fetch within the authenticated app so App Bridge can attach a session
      // token. A new window has neither that token nor reliable iframe cookies.
      const response = await fetch(`/app/audit-report.csv?${filterQuery}`);
      if (
        !response.ok ||
        !response.headers.get("Content-Type")?.startsWith("text/csv")
      ) {
        throw new Error("Audit report download failed");
      }
      const blob = await response.blob();
      if (blob.size === 0) throw new Error("Audit report was empty");
      const objectUrl = URL.createObjectURL(blob);
      setDownloadUrl(objectUrl);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = `safety-gate-audit-report-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    } catch {
      setExportFailed(true);
    } finally {
      setExporting(false);
    }
  }

  return (
    <s-page size="large" className="page-shell">
      <s-heading slot="title" size="large">
        {t("workspace.reportTitle")}
      </s-heading>
      <s-button
        slot="primary-action"
        variant="primary"
        disabled={exporting}
        loading={exporting}
        onClick={downloadReport}
      >
        {t("auditReport.download")}
      </s-button>
      <s-button
        slot="secondary-actions"
        variant="secondary"
        onClick={() => navigate("/app/evidence")}
      >
        {t("auditReport.viewHistory")}
      </s-button>
      <div className="admin-stack">
        {exportFailed ? (
          <s-banner tone="critical" heading={t("errors.apiError")}>
            <s-text>{t("actions.retry")}</s-text>
          </s-banner>
        ) : null}
        <section className="admin-card">
          <div className="admin-card__header">
            <div>
              <p className="admin-eyebrow">{t("auditReport.eyebrow")}</p>
              <h2 className="admin-card__title">{t("auditReport.heading")}</h2>
              <p className="admin-card__description">
                {t("workspace.exportHelp")}
              </p>
            </div>
          </div>
          <p>
            <strong>
              {t("workspace.shop")}: {shop}
            </strong>
          </p>
          {scope.from && scope.to && (
            <p>
              {t("workspace.scope", {
                from: new Date(scope.from).toLocaleDateString(i18n.language, { timeZone: "UTC" }),
                to: new Date(scope.to).toLocaleDateString(i18n.language, { timeZone: "UTC" }),
              })}
            </p>
          )}
          <Form method="get" className="report-filters">
            <label>
              {t("workspace.from")}
              <input type="date" name="from" defaultValue={filters.from} />
            </label>
            <label>
              {t("workspace.to")}
              <input type="date" name="to" defaultValue={filters.to} />
            </label>
            <label>
              {t("workspace.status")}
              <select name="status" defaultValue={filters.status}>
                <option value="">{t("workspace.all")}</option>
                {["active", "resolved", "dismissed"].map((value) => (
                  <option key={value} value={value}>
                    {t(
                      value === "active"
                        ? "status.needsReview"
                        : `status.${value}`,
                    )}
                  </option>
                ))}
              </select>
            </label>
            <s-button type="submit">{t("workspace.apply")}</s-button>
          </Form>
          <s-button variant="secondary" onClick={() => window.print()}>
            {t("workspace.print")}
          </s-button>
          <p className="admin-helper">
            {t("workspace.historyLimit", { count: 100 })}
          </p>
          {downloadUrl ? (
            <p role="status">
              {t("workspace.exportReady")}
              <a
                href={downloadUrl}
                download={`safety-gate-audit-report-${new Date().toISOString().slice(0, 10)}.csv`}
              >
                {t("auditReport.download")}
              </a>
            </p>
          ) : null}
          <div
            className="audit-report-summary"
            aria-label={t("auditReport.summaryLabel")}
          >
            <div>
              <span>{t("auditReport.total")}</span>
              <strong>{total}</strong>
            </div>
            <div>
              <span>{t("auditReport.needsReview")}</span>
              <strong>{active}</strong>
            </div>
            <div>
              <span>{t("workspace.documentedFindings")}</span>
              <strong>{documented}</strong>
            </div>
          </div>
          <p className="audit-report-generated">
            <LocalDateTime value={generatedAt} locale={i18n.language} render={(date) => t("auditReport.generated", { date })} />
          </p>
        </section>
        <section className="admin-card">
          {records.length === 0 ? (
            <s-box padding="large">
              <s-text tone="subdued">{t("auditReport.empty")}</s-text>
            </s-box>
          ) : (
            <div
              className="audit-report-table-wrap"
              aria-label={t("auditReport.tableLabel")}
            >
              <s-table accessibilityLabel={t("auditReport.tableLabel")}>
                <s-table-header-row>
                  <s-table-header listSlot="primary">
                    {t("auditReport.product")}
                  </s-table-header>
                  <s-table-header listSlot="inline">
                    {t("workspace.status")}
                  </s-table-header>
                  <s-table-header>{t("workspace.findings")}</s-table-header>
                  <s-table-header>{t("workspace.outcome")}</s-table-header>
                  <s-table-header>{t("workspace.when")}</s-table-header>
                </s-table-header-row>
                <s-table-body>
                  {records.map((record) => (
                    <s-table-row key={record.id}>
                      <s-table-cell>
                        <s-link
                          href={`/app/alerts?view=all&open=${encodeURIComponent(record.id)}`}
                        >
                          {record.productTitle}
                        </s-link>
                      </s-table-cell>
                      <s-table-cell>
                        {isWaitingForSupplier(record)
                          ? t("workspace.waiting")
                          : t(
                              record.status === "active"
                                ? "status.needsReview"
                                : `status.${record.status}`,
                            )}
                      </s-table-cell>
                      <s-table-cell>
                        <p>{localizeRisk(record.riskLevel, t)}</p>
                        {record.caseNumber && <p>{record.caseNumber}</p>}
                        {record.url ? (
                          <s-link href={record.url} target="_blank">
                            {t("analysis.viewOnSafetyGate")}
                          </s-link>
                        ) : (
                          <p>{t("workspace.sourceMissing")}</p>
                        )}
                        <p>{record.reason}</p>
                      </s-table-cell>
                      <s-table-cell>
                        <p>{t(decisionKey(record.resolutionType))}</p>
                        {record.notes && <p>{record.notes}</p>}
                        {record.decisions[0] && (
                          <p>
                            {t("workspace.who")}: {record.decisions[0].actorId}
                          </p>
                        )}
                      </s-table-cell>
                      <s-table-cell>
                        {record.createdAt &&
                          <LocalDateTime value={record.createdAt} locale={i18n.language} />}
                      </s-table-cell>
                    </s-table-row>
                  ))}
                </s-table-body>
              </s-table>
            </div>
          )}
        </section>
      </div>
    </s-page>
  );
}

export function ErrorBoundary() {
  const { t } = useTranslation();
  const error = useRouteError();
  if (
    isRouteErrorResponse(error) &&
    (error.status === 200 || !error.statusText)
  ) {
    return boundary.error(error);
  }
  const message = isRouteErrorResponse(error)
    ? error.statusText || t("errors.unknown")
    : error instanceof Error
      ? error.message
      : t("errors.unknown");
  return (
    <s-page size="large">
      <s-heading slot="title" size="large">
        {t("workspace.reportTitle")}
      </s-heading>
      <s-banner tone="critical" heading={t("errors.pageLoadFailed")}>
        <s-text>{message}</s-text>
        <s-button slot="secondary-actions" href="/app/audit-report">
          {t("actions.retry")}
        </s-button>
      </s-banner>
    </s-page>
  );
}
