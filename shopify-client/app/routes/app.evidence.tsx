import { AdminCard } from "../components/AdminCard";
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
import {
  decisionKey,
  formatActorId,
  isWaitingForSupplier,
} from "../services/review-evidence";
import { localizeRisk } from "../components/AlertBadge";
import { ReviewStatusSummary, reviewStatusOptions } from "../components/ReviewStatusSummary";
export const headers = boundary.headers;
export const loader = async ({ request, url }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const view = url.searchParams.get("view") === "findings" ? "findings" : "decisions";
  const filters = { ...reviewFilters(url), dateBasis: view as "findings" | "decisions" };
  return json({
    ...(await reviewRecords(session.shop, filters, 100)),
    view,
  });
};
export default function EvidencePage() {
  const { records, total, view, filters, shopSummary } =
    useLoaderData<typeof loader>();
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [search, setSearch] = useState(filters.query || "");
  const [status, setStatus] = useState(filters.status || "");
  const [fromDate, setFromDate] = useState(filters.from || "");
  const [toDate, setToDate] = useState(filters.to || "");
  const [exporting, setExporting] = useState(false);
  const [exportFailed, setExportFailed] = useState(false);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const timeZone = filters.timeZone || "Europe/Bratislava";
  const hasFilters = Boolean(filters.from || filters.to || filters.status || filters.query);
  useEffect(() => {
    setSearch(filters.query || ""); setStatus(filters.status || "");
    setFromDate(filters.from || ""); setToDate(filters.to || "");
  }, [filters]);

  const queryFor = (targetView = view, clear = false) => {
    const values = clear ? { view: targetView } : { view: targetView, dateBasis: targetView, from: fromDate, to: toDate, status, q: search, timeZone };
    return new URLSearchParams(Object.entries(values).filter(([, value]) => value)).toString();
  };
  const applyFilters = () => {
    setDownloadUrl(null);
    navigate(`/app/evidence?${queryFor()}`);
  };
  const clearFilters = () => {
    setDownloadUrl(null);
    navigate(`/app/evidence?${queryFor(view, true)}`);
  };

  useEffect(
    () => () => {
      if (downloadUrl) URL.revokeObjectURL(downloadUrl);
    },
    [downloadUrl],
  );

  const findings = records;
  const events = findings
    .flatMap((record) =>
      record.decisions.map((event: any) => ({ ...event, record })),
    )
    .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));

  async function downloadReport() {
    if (exporting) return;
    setExporting(true);
    setExportFailed(false);
    try {
      const query = new URLSearchParams(Object.entries({ ...filters, lang: i18n.resolvedLanguage || i18n.language }).filter(([, value]) => typeof value === "string" && value).map(([key, value]) => [key, String(value)])).toString();
      const response = await fetch(
        `/app/audit-report.csv${query ? `?${query}` : ""}`,
      );
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
      anchor.download = `zerorecall-checks-decisions-${new Date().toISOString().slice(0, 10)}.csv`;
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
      <s-heading slot="title">{t("workspace.history")}</s-heading>
      <s-button
        slot="primary-action"
        variant="primary"
        disabled={exporting}
        loading={exporting}
        onClick={downloadReport}
      >
        {t("workspace.download")}
      </s-button>
      <s-button
        slot="secondary-actions"
        variant="secondary"
        onClick={() => window.print()}
      >
        {t("workspace.print")}
      </s-button>
      <s-button
        slot="secondary-actions"
        variant="tertiary"
        href="/app/audit-report"
      >
        {t("workspace.reportTitle")}
      </s-button>
      <div className="admin-stack">
        {exportFailed ? (
          <s-banner tone="critical" heading={t("errors.apiError")}>
            <s-text>{t("actions.retry")}</s-text>
          </s-banner>
        ) : null}
        <AdminCard className="admin-card">
          <div className="admin-card__header">
            <h2 className="admin-card__title">{t("reviewOverview.current")}</h2>
            {shopSummary.needsReview + shopSummary.waiting > 0 && (
              <s-link href="/app/alerts?status=active">{t("workspace.goReview")}</s-link>
            )}
          </div>
          <ReviewStatusSummary title={t("reviewOverview.current")} counts={shopSummary} />
        </AdminCard>

        <AdminCard className="admin-card">
          <div
            className="admin-card__header"
            style={{ marginBottom: "12px" }}
          >
            <div>
              <h2 className="admin-card__title">{t(view === "decisions" ? "reviewOverview.decisions" : "workspace.findings")}</h2>
            </div>
            <div className="admin-actions">
              <s-button
                variant={view === "decisions" ? "secondary" : "tertiary"}
                onClick={() => { setDownloadUrl(null); navigate(`/app/evidence?${queryFor("decisions")}`); }}
              >
                {t("workspace.history")}
              </s-button>
              <s-button
                variant={view === "findings" ? "secondary" : "tertiary"}
                onClick={() => { setDownloadUrl(null); navigate(`/app/evidence?${queryFor("findings")}`); }}
              >
                {t("workspace.findings")}
              </s-button>
            </div>
          </div>

          <details className="review-filters-disclosure" open={hasFilters || undefined}>
            <summary>{t("pendingCoverage.filters")}</summary>
            <Form method="get" className="admin-toolbar evidence-toolbar" onSubmit={event => { event.preventDefault(); applyFilters(); }}>
              <input type="hidden" name="view" value={view} />
              <s-text-field
                label={t("evidence.filters.searchLabel")}
                placeholder={t("evidence.filters.searchPlaceholder")}
                value={search}
                onInput={(event: any) =>
                  setSearch(event.currentTarget.value || "")
                }
              />
              <s-select
                label={t("workspace.currentFindingStatus")}
                name="status"
                value={status}
                onChange={(event: any) => setStatus(event.currentTarget.value)}
              >
                <s-option value="">{t("workspace.all")}</s-option>
                {reviewStatusOptions.map(([value, label]) => (
                  <s-option key={value} value={value}>{t(label)}</s-option>
                ))}
              </s-select>
              <div className="report-filters" style={{ margin: 0 }}>
                <label>
                  {t(view === "decisions" ? "workspace.decisionFrom" : "workspace.findingFrom")}
                  <input
                    type="date"
                    name="from"
                    value={fromDate}
                    onChange={(e) => setFromDate(e.currentTarget.value)}
                  />
                </label>
                <label>
                  {t(view === "decisions" ? "workspace.decisionTo" : "workspace.findingTo")}
                  <input
                    type="date"
                    name="to"
                    value={toDate}
                    onChange={(e) => setToDate(e.currentTarget.value)}
                  />
                </label>
              </div>
              <s-button variant="secondary" onClick={applyFilters}>{t("workspace.applyFilters")}</s-button>
              {hasFilters && <s-button variant="tertiary" onClick={clearFilters}>{t("workspace.clearFilters")}</s-button>}
            </Form>
            <p className="admin-helper">{t("workspace.dateFilterTimezone", { timeZone })}</p>
          </details>
          {downloadUrl ? (
            <p role="status" className="admin-helper">
              {t("workspace.exportReady")}{" "}
              <a
                href={downloadUrl}
                download={`zerorecall-checks-decisions-${new Date().toISOString().slice(0, 10)}.csv`}
              >
                {t("auditReport.download")}
              </a>
            </p>
          ) : null}
          {total > records.length && (
            <p className="admin-helper">{t("workspace.historyLimit", { count: 100 })}</p>
          )}
          {view === "decisions" ? (
            events.length === 0 ? (
              <div className="admin-empty-state">
                <p>{t(hasFilters ? "workspace.noFilteredDecisions" : "reviewOverview.emptyDecisions")}</p>
                {hasFilters && <s-button onClick={clearFilters}>{t("workspace.clearFilters")}</s-button>}
              </div>
            ) : (
              <div className="decision-event-list">
                {events.map((event) => (
                  <article
                    className="decision-event"
                    key={`${event.record.id}-${event.id}`}
                  >
                    <s-link
                      href={`/app/alerts?view=all&open=${encodeURIComponent(event.record.id)}`}
                    >
                      {event.record.productTitle}
                    </s-link>
                    <p>
                      <strong>{t(event.action === "reactivate" ? "workspace.reopened" : decisionKey(event.resolutionType))}</strong> ·{" "}
                      {t(
                        event.reviewState === "waiting_for_supplier"
                          ? "workspace.waiting"
                          : `status.${event.reviewState === "needs_review" ? "needsReview" : event.reviewState}`,
                      )}
                    </p>
                    <p className="admin-helper">
                      {t("workspace.when")}:{" "}
                      {event.createdAt && (
                        <LocalDateTime
                          value={event.createdAt}
                          locale={i18n.language}
                          timeZone={filters.timeZone}
                        />
                      )}{" "}
                      · {t("workspace.who")}:{" "}
                      {formatActorId(event.actorId) || t("common.unknown")}
                    </p>
                    {event.notes && <p>{event.notes}</p>}
                  </article>
                ))}
              </div>
            )
          ) : findings.length === 0 ? (
            <div className="admin-empty-state">
              <p>{t("workspace.reportEmpty")}</p>
              {hasFilters && <s-button onClick={clearFilters}>{t("workspace.clearFilters")}</s-button>}
            </div>
          ) : (
            <s-table accessibilityLabel={t("workspace.findings")}>
              <s-table-header-row>
                <s-table-header listSlot="primary">
                  {t("evidence.table.product")}
                </s-table-header>
                <s-table-header listSlot="inline">
                  {t("workspace.status")}
                </s-table-header>
                <s-table-header>{t("workspace.outcome")}</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {findings.map((record) => (
                  <s-table-row key={record.id}>
                    <s-table-cell>
                      <s-link
                        href={`/app/alerts?view=all&open=${encodeURIComponent(record.id)}`}
                      >
                        {record.productTitle}
                      </s-link>
                      {record.caseNumber && <p>{record.caseNumber}</p>}
                      {record.url && (
                        <s-link href={record.url} target="_blank">
                          {t("analysis.viewOnSafetyGate")}
                        </s-link>
                      )}
                    </s-table-cell>
                    <s-table-cell>
                      <s-badge
                        tone={record.status === "active" ? "warning" : "info"}
                      >
                        {isWaitingForSupplier(record)
                          ? t("workspace.waiting")
                          : t(
                              record.status === "active"
                                ? "status.needsReview"
                                : `status.${record.status}`,
                            )}
                      </s-badge>
                      <p>{localizeRisk(record.riskLevel, t)}</p>
                    </s-table-cell>
                    <s-table-cell>
                      {t(!record.resolutionType && record.decisions.length ? "workspace.reopened" : decisionKey(record.resolutionType))}
                      {record.notes && <p>{record.notes}</p>}
                    </s-table-cell>
                  </s-table-row>
                ))}
              </s-table-body>
            </s-table>
          )}
        </AdminCard>
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
        {t("evidence.title")}
      </s-heading>
      <s-banner tone="critical" heading={t("errors.pageLoadFailed")}>
        <s-text>{message}</s-text>
        <s-button slot="secondary-actions" href="/app/evidence">
          {t("actions.retry")}
        </s-button>
      </s-banner>
    </s-page>
  );
}
