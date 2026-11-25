import { AdminCard } from "../components/AdminCard";
import { LocalDateTime, useHydrated } from "../components/LocalDateTime";
import type { LoaderFunctionArgs } from "react-router";
import {
  Form,
  data as json,
  isRouteErrorResponse,
  useLoaderData,
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
import {
  decisionKey,
  formatActorId,
  isWaitingForSupplier,
} from "../services/review-evidence";
import { localizeRisk } from "../components/AlertBadge";
import { HistoryNav } from "../components/HistoryNav";
import { monitoringEvidence } from "../services/monitoring-evidence.server";
import { ReviewStatusSummary, reviewStatusOptions } from "../components/ReviewStatusSummary";
import { checkLedger } from "../services/check-ledger.server";
import { CheckLedger } from "../components/CheckLedger";

export const headers = (headersArgs: any) => {
  return boundary.headers(headersArgs);
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const [records, monitoring, ledger] = await Promise.all([
    reviewRecords(session.shop, { ...reviewFilters(url), dateBasis: "findings" }, 100),
    monitoringEvidence(session.shop),
    checkLedger(session.shop, url),
  ]);
  return json({ ...records, monitoring, ledger });
};

export default function AuditReportPage() {
  const { records, generatedAt, total, shop, filters, summary, scope, monitoring, ledger } =
    useLoaderData<typeof loader>();
  const { t, i18n } = useTranslation();
  const hydrated = useHydrated();
  const [exporting, setExporting] = useState(false);
  const [exportFailed, setExportFailed] = useState(false);
  const [download, setDownload] = useState<{ url: string; query: string } | null>(null);
  const [statusFilter, setStatusFilter] = useState(filters.status || "");
  useEffect(() => {
    setStatusFilter(filters.status || "");
  }, [filters.status]);
  useEffect(
    () => () => {
      if (download) URL.revokeObjectURL(download.url);
    },
    [download],
  );
  const hasFilters = Boolean(filters.from || filters.to || filters.status || filters.query);
  const filterQuery = new URLSearchParams(
    Object.entries({ ...filters, lang: i18n.resolvedLanguage || i18n.language }).filter(([, value]) => typeof value === "string" && value).map(([key, value]) => [key, String(value)]),
  ).toString();
  const downloadUrl = download?.query === filterQuery ? download.url : null;

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
      setDownload({ url: objectUrl, query: filterQuery });
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
    <s-page inlineSize="large" className="page-shell" heading={t("workspace.reportTitle")}>

      <s-button
        slot="primary-action"
        variant="primary"
        disabled={exporting}
        loading={exporting}
        onClick={downloadReport}
      >
        {t("checkLedger.findingDownload")}
      </s-button>
      <s-button slot="secondary-actions" variant="secondary" onClick={() => window.print()}>
        {t("workspace.print")}
      </s-button>
      <div className="admin-stack">
        <HistoryNav active="report" />
        <CheckLedger ledger={ledger} />
        {exportFailed ? (
          <s-banner tone="critical" heading={t("errors.apiError")}>
            <s-button onClick={downloadReport} disabled={exporting} loading={exporting}>{t("actions.retry")}</s-button>
          </s-banner>
        ) : null}
        <AdminCard className="admin-card">
          <div className="admin-card__header">
            <div>
              <h2 className="admin-card__title">{t("checkLedger.findings")}</h2>
            </div>
            {summary.needsReview + summary.waiting > 0 && (
              <s-link href="/app/alerts?status=active">{t("workspace.goReview")}</s-link>
            )}
          </div>
          <ReviewStatusSummary title={t("reviewOverview.report")} counts={summary} />
          <p>
            <strong>
              {t("workspace.shop")}: {shop}
            </strong>
          </p>
          {scope.from && scope.to && (
            <p>
              {t("workspace.scope", {
                from: hydrated
                  ? new Date(scope.from).toLocaleDateString(
                      i18n.resolvedLanguage || i18n.language || undefined,
                      { timeZone: filters.timeZone || "UTC" },
                    )
                  : scope.from.slice(0, 10),
                to: hydrated
                  ? new Date(scope.to).toLocaleDateString(
                      i18n.resolvedLanguage || i18n.language || undefined,
                      { timeZone: filters.timeZone || "UTC" },
                    )
                  : scope.to.slice(0, 10),
              })}
            </p>
          )}
          <details className="review-filters-disclosure" open={hasFilters || undefined}>
            <summary>{t("reviewOverview.filters")}</summary>
            <Form method="get" className="report-filters" key={filterQuery}>
              {filters.timeZone && <input type="hidden" name="timeZone" value={filters.timeZone} />}
              {filters.query && <input type="hidden" name="q" value={filters.query} />}
              <input type="hidden" name="status" value={statusFilter} />
              <label>
                {t("workspace.findingFrom")}
                <input type="date" name="from" defaultValue={filters.from} />
              </label>
              <label>
                {t("workspace.findingTo")}
                <input type="date" name="to" defaultValue={filters.to} />
              </label>
              <s-select
                label={t("workspace.status")}
                value={statusFilter}
                onChange={(event: any) => setStatusFilter(event.currentTarget.value)}
              >
                <s-option value="">{t("workspace.all")}</s-option>
                {reviewStatusOptions.map(([value, label]) => (
                  <s-option key={value} value={value}>{t(label)}</s-option>
                ))}
              </s-select>
              <s-button type="submit" variant="secondary">{t("workspace.applyFilters")}</s-button>
              {hasFilters && <s-link href="/app/audit-report">{t("workspace.clearFilters")}</s-link>}
            </Form>
          </details>
          {total > records.length && (
            <p className="admin-helper">{t("workspace.historyLimit", { count: 100 })}</p>
          )}
          {downloadUrl ? (
            <p role="status">
              {t("workspace.exportReady")}
              <a
                href={downloadUrl}
                download={`safety-gate-audit-report-${generatedAt.slice(0, 10)}.csv`}
              >
                {t("auditReport.download")}
              </a>
            </p>
          ) : null}
          <p className="audit-report-generated">
            <LocalDateTime
              value={generatedAt}
              locale={i18n.language}
              render={(date) => t("auditReport.generated", { date })}
            />
          </p>
        </AdminCard>
        <AdminCard className="admin-card">
          {records.length === 0 ? (
            <s-box padding="large">
              <s-text tone="subdued">{t("workspace.reportEmpty")}</s-text>
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
                  <s-table-header listSlot="labeled">{t("workspace.findings")}</s-table-header>
                  <s-table-header listSlot="labeled">{t("workspace.outcome")}</s-table-header>
                  <s-table-header listSlot="labeled">{t("workspace.detectedAt")}</s-table-header>
                  <s-table-header listSlot="labeled">{t("workspace.decisionAt")}</s-table-header>
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
                        <s-badge tone={record.status === "active" ? "warning" : "subdued"}>
                        {isWaitingForSupplier(record)
                          ? t("workspace.waiting")
                          : t(
                              record.status === "active"
                                ? "status.needsReview"
                                : `status.${record.status}`,
                            )}
                        </s-badge>
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
                      </s-table-cell>
                      <s-table-cell>
                        <p>{t(!record.resolutionType && record.decisions.length ? "workspace.reopened" : decisionKey(record.resolutionType))}</p>
                        {record.notes && <p>{record.notes}</p>}
                        {record.resolutionType && record.decisions[0] && (
                          <p>
                            {t("workspace.who")}:{" "}
                            {formatActorId(record.decisions[0].actorId) ||
                              t("common.unknown")}
                          </p>
                        )}
                      </s-table-cell>
                      <s-table-cell>
                        {record.createdAt && (
                          <LocalDateTime
                            value={record.createdAt}
                            locale={i18n.language}
                          />
                        )}
                      </s-table-cell>
                      <s-table-cell>
                        {record.resolutionType && (record.decisions[0]?.createdAt || record.resolvedAt || record.dismissedAt) ? (
                          <LocalDateTime value={record.decisions[0]?.createdAt || record.resolvedAt || record.dismissedAt} locale={i18n.language} />
                        ) : "—"}
                      </s-table-cell>
                    </s-table-row>
                  ))}
                </s-table-body>
              </s-table>
            </div>
          )}
        </AdminCard>
        <AdminCard className="admin-card">
          <h2 className="admin-card__title">{t("monitorEvidence.title")}</h2>
          <dl className="audit-monitoring-facts">
            <div><dt>{t("monitorEvidence.initialStatus")}</dt><dd>{monitoring.initialStatus ? t(`monitorEvidence.states.${monitoring.initialStatus}`, { defaultValue: t("monitorEvidence.unknown") }) : t("monitorEvidence.unknown")}</dd></div>
            <div><dt>{t("monitorEvidence.imported")}</dt><dd>{monitoring.importedProducts === null ? t("monitorEvidence.unknown") : new Intl.NumberFormat(i18n.resolvedLanguage || i18n.language).format(monitoring.importedProducts)}</dd></div>
            <div><dt>{t("monitorEvidence.monitorStatus")}</dt><dd>{monitoring.monitorStatus ? t(`monitorEvidence.states.${monitoring.monitorStatus}`, { defaultValue: t("monitorEvidence.unknown") }) : t("monitorEvidence.unknown")}</dd></div>
            <div><dt>{t("monitorEvidence.monitorEnded")}</dt><dd>{monitoring.monitorEndedAt ? <LocalDateTime value={monitoring.monitorEndedAt} locale={i18n.resolvedLanguage || i18n.language} /> : t("monitorEvidence.unknown")}</dd></div>
            <div><dt>{t("monitorEvidence.sourceStatus")}</dt><dd>{monitoring.sourceStatus ? t(`monitorEvidence.states.${monitoring.sourceStatus}`, { defaultValue: t("monitorEvidence.unknown") }) : t("monitorEvidence.unknown")}</dd></div>
            <div><dt>{t("monitorEvidence.sourceEnded")}</dt><dd>{monitoring.sourceEndedAt ? <LocalDateTime value={monitoring.sourceEndedAt} locale={i18n.resolvedLanguage || i18n.language} /> : t("monitorEvidence.unknown")}</dd></div>
          </dl>
          <p>{t("monitorEvidence.limit")}</p>
        </AdminCard>
        <p className="admin-helper">{t("workspace.exportHelp")}</p>
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
    <s-page inlineSize="large" heading={t("workspace.reportTitle")}>

      <s-banner tone="critical" heading={t("errors.pageLoadFailed")}>
        <s-text>{message}</s-text>
        <s-button slot="secondary-actions" href="/app/audit-report">
          {t("actions.retry")}
        </s-button>
      </s-banner>
    </s-page>
  );
}
