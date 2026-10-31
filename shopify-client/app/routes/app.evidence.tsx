import { AdminCard } from "../components/AdminCard";
import { LocalDateTime } from "../components/LocalDateTime";
import type { LoaderFunctionArgs } from "react-router";
import {
  data as json,
  isRouteErrorResponse,
  useLoaderData,
  useNavigate,
  useRouteError,
} from "react-router";
import { useTranslation } from "react-i18next";
import { useState } from "react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { reviewRecords } from "../services/review-records.server";
import { decisionKey, isWaitingForSupplier } from "../services/review-evidence";
import { localizeRisk } from "../components/AlertBadge";
export const headers = boundary.headers;
export const loader = async ({ request, url }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  return json({
    ...(await reviewRecords(
      session.shop,
      { from: "", to: "", status: "" },
      100,
    )),
    view:
      url.searchParams.get("view") === "findings" ? "findings" : "decisions",
  });
};
export default function EvidencePage() {
  const { records, total, view } = useLoaderData<typeof loader>();
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const findings = records.filter(
    (record) =>
      (!status || record.status === status) &&
      [record.productTitle, record.caseNumber, record.reason, record.notes]
        .join(" ")
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const events = findings
    .flatMap((record) =>
      record.decisions.map((event: any) => ({ ...event, record })),
    )
    .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
  return (
    <s-page size="large" className="page-shell">
      <s-heading slot="title">{t("workspace.history")}</s-heading>
      <s-button slot="primary-action" href="/app/audit-report">
        {t("workspace.reportTitle")}
      </s-button>
      <div className="admin-stack">
        <AdminCard className="admin-card">
          <div className="admin-actions">
            <s-button
              variant={view === "decisions" ? "secondary" : "tertiary"}
              onClick={() => navigate("/app/evidence?view=decisions")}
            >
              {t("workspace.history")}
            </s-button>
            <s-button
              variant={view === "findings" ? "secondary" : "tertiary"}
              onClick={() => navigate("/app/evidence?view=findings")}
            >
              {t("workspace.findings")}
            </s-button>
          </div>
          <div className="admin-toolbar evidence-toolbar">
            <s-text-field
              label={t("evidence.filters.searchLabel")}
              value={search}
              onInput={(event: any) =>
                setSearch(event.currentTarget.value || "")
              }
            />
            <s-select
              label={t("workspace.status")}
              value={status}
              onChange={(event: any) => setStatus(event.currentTarget.value)}
            >
              <s-option value="">{t("workspace.all")}</s-option>
              {["active", "resolved", "dismissed"].map((value) => (
                <s-option key={value} value={value}>
                  {t(
                    value === "active"
                      ? "status.needsReview"
                      : `status.${value}`,
                  )}
                </s-option>
              ))}
            </s-select>
          </div>
          <p className="admin-helper">
            {t("workspace.historyLimit", { count: 100 })}{" "}
            {t("workspace.findingCount", { count: total })}
          </p>
          <div role="status" className="admin-helper">
            {view === "decisions"
              ? t("workspace.eventCount", { count: events.length })
              : t("evidence.records", { count: findings.length })}
          </div>
          {view === "decisions" ? (
            events.length === 0 ? (
              <div className="admin-empty-state">
                <p>{t("workspace.noDecisions")}</p>
                <s-button href="/app/alerts?status=active">
                  {t("workspace.goReview")}
                </s-button>
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
                        />
                      )}{" "}
                      · {t("workspace.who")}:{" "}
                      {event.actorId || t("common.unknown")}
                    </p>
                    {event.notes && <p>{event.notes}</p>}
                  </article>
                ))}
              </div>
            )
          ) : (
            <s-table accessibilityLabel={t("workspace.findings")}>
              <s-table-header-row>
                <s-table-header listSlot="primary">
                  {t("evidence.table.product")}
                </s-table-header>
                <s-table-header listSlot="inline">
                  {t("workspace.status")}
                </s-table-header>
                <s-table-header>{t("workspace.whyMatch")}</s-table-header>
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
                      <p>{t("workspace.matchNeedsVerification")}</p>
                      {record.sourceRisk && <p><strong>{t("workspace.sourceRisk")}: </strong>{record.sourceRisk}</p>}
                    </s-table-cell>
                    <s-table-cell>
                      {t(decisionKey(record.resolutionType))}
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
