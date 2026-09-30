import type { LoaderFunctionArgs } from "react-router";
import { data as json, isRouteErrorResponse, useLoaderData, useNavigate, useRouteError } from "react-router";
import { useTranslation } from "react-i18next";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../merchant-db.server";

export const headers = (headersArgs: any) => {
  return boundary.headers(headersArgs);
};

function parsePrimaryWarning(checkResult: string | null | undefined) {
  try {
    const parsed = checkResult ? JSON.parse(checkResult) : null;
    const warning = Array.isArray(parsed?.warnings) ? parsed.warnings[0] : null;
    return {
      alertType: warning?.alertType || warning?.alertDetails?.fields?.alert_type || "",
      riskLevel: warning?.alertDetails?.fields?.alert_level || warning?.alertDetails?.fields?.risk_level || warning?.riskLevel || "",
      overallSimilarity: typeof warning?.overallSimilarity === "number" ? warning.overallSimilarity : "",
      safetyGateAlert: warning?.alertDetails?.fields?.alert_number || warning?.alertId || "",
      recommendation: parsed?.recommendation || "",
    };
  } catch {
    return { alertType: "", riskLevel: "", overallSimilarity: "", safetyGateAlert: "", recommendation: "" };
  }
}

function resolutionLabelKey(resolutionType: string | null) {
  const keys: Record<string, string> = {
    verified_safe: "verifiedSafe",
    removed_from_sale: "removedFromSale",
    modified_product: "modifiedProduct",
    contacted_supplier: "contactedSupplier",
    false_positive: "falsePositive",
    not_my_product: "notMyProduct",
    other: "other",
  };
  return resolutionType ? keys[resolutionType] : undefined;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const batchSize = 500;
  const alerts: any[] = [];
  for (let skip = 0; ; skip += batchSize) {
    const batch = await db.safetyAlert.findMany({
      where: { shop: session.shop },
      orderBy: { createdAt: "desc" },
      skip,
      take: batchSize,
    });
    alerts.push(...batch);
    if (batch.length < batchSize) break;
  }
  const records = alerts.map((alert: any) => ({ ...alert, warning: parsePrimaryWarning(alert.checkResult) }));

  return json({
    generatedAt: new Date().toISOString(),
    records: records.map(({ warning, ...alert }) => ({ id: alert.id, productTitle: alert.productTitle, status: alert.status, resolutionType: alert.resolutionType, createdAt: alert.createdAt, ...warning })),
  });
};

export default function AuditReportPage() {
  const { records, generatedAt } = useLoaderData<typeof loader>();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const active = records.filter((record: any) => record.status === "active").length;
  const documented = records.filter((record: any) => record.status !== "active").length;

  return (
    <s-page size="large" className="page-shell">
      <s-heading slot="title" size="large">{t("auditReport.title")}</s-heading>
      <s-button slot="primary-action" variant="primary" onClick={() => window.open("/app/audit-report.csv", "_blank", "noopener,noreferrer")}>{t("auditReport.download")}</s-button>
      <s-button slot="secondary-actions" variant="secondary" onClick={() => navigate("/app/evidence")}>
        {t("auditReport.viewHistory")}
      </s-button>
      <div className="admin-stack">
        <section className="admin-card">
          <div className="admin-card__header"><div><p className="admin-eyebrow">{t("auditReport.eyebrow")}</p><h2 className="admin-card__title">{t("auditReport.heading")}</h2><p className="admin-card__description">{t("auditReport.description")}</p></div></div>
          <div className="audit-report-summary" aria-label={t("auditReport.summaryLabel")}>
            <div><span>{t("auditReport.total")}</span><strong>{records.length}</strong></div>
            <div><span>{t("auditReport.needsReview")}</span><strong>{active}</strong></div>
            <div><span>{t("auditReport.documented")}</span><strong>{documented}</strong></div>
          </div>
          <p className="audit-report-generated">{t("auditReport.generated", { date: new Date(generatedAt).toLocaleString() })}</p>
        </section>
        <section className="admin-card">
          {records.length === 0 ? <s-box padding="large"><s-text tone="subdued">{t("auditReport.empty")}</s-text></s-box> : (
            <div className="audit-report-table-wrap" aria-label={t("auditReport.tableLabel")}>
              <s-table accessibilityLabel={t("auditReport.tableLabel")}>
                <s-table-header-row><s-table-header listSlot="primary">{t("auditReport.product")}</s-table-header><s-table-header listSlot="inline">{t("auditReport.status")}</s-table-header><s-table-header>{t("auditReport.risk")}</s-table-header><s-table-header>{t("auditReport.decision")}</s-table-header><s-table-header>{t("auditReport.detected")}</s-table-header></s-table-header-row>
                <s-table-body>{records.map((record: any) => <s-table-row key={record.id}><s-table-cell>{record.productTitle}</s-table-cell><s-table-cell><s-badge tone={record.status === "active" ? "critical" : "success"}>{record.status === "active" ? t("status.needsReview") : t(`status.${record.status}`)}</s-badge></s-table-cell><s-table-cell>{record.riskLevel || t("common.unknown")}</s-table-cell><s-table-cell>{t(resolutionLabelKey(record.resolutionType) ? `resolveActions.${resolutionLabelKey(record.resolutionType)}` : "auditReport.notRecorded")}</s-table-cell><s-table-cell>{new Date(record.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</s-table-cell></s-table-row>)}</s-table-body>
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
  if (isRouteErrorResponse(error) && (error.status === 200 || !error.statusText)) {
    return boundary.error(error);
  }
  const message = isRouteErrorResponse(error) ? error.statusText || t("errors.unknown") : error instanceof Error ? error.message : t("errors.unknown");
  return <s-page size="large"><s-heading slot="title" size="large">{t("auditReport.title")}</s-heading><s-banner tone="critical" heading={t("errors.pageLoadFailed")}><s-text>{message}</s-text><s-button slot="secondary-actions" href="/app/audit-report">{t("actions.retry")}</s-button></s-banner></s-page>;
}
