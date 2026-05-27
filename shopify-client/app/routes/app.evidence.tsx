import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useNavigate } from "@remix-run/react";
import { useTranslation } from "react-i18next";
import { authenticate } from "../shopify.server";
import db from "../merchant-db.server";
import { formatRelativeDate } from "../components/AlertTable";

function parseAlertSummary(checkResult: string | null | undefined) {
  try {
    const parsed = checkResult ? JSON.parse(checkResult) : null;
    const warning = Array.isArray(parsed?.warnings) ? parsed.warnings[0] : null;
    return {
      reason: warning?.reason || parsed?.recommendation || "",
      riskLevel:
        warning?.alertDetails?.fields?.alert_level ||
        warning?.alertDetails?.fields?.risk_level ||
        warning?.riskLevel ||
        "",
      alertNumber: warning?.alertDetails?.fields?.alert_number || "",
    };
  } catch {
    return { reason: "", riskLevel: "", alertNumber: "" };
  }
}

function resolutionLabelKey(resolutionType: string | null) {
  switch (resolutionType) {
    case "verified_safe":
      return "resolveActions.verifiedSafe";
    case "removed_from_sale":
      return "resolveActions.removedFromSale";
    case "modified_product":
      return "resolveActions.modifiedProduct";
    case "contacted_supplier":
      return "resolveActions.contactedSupplier";
    case "false_positive":
      return "resolveActions.falsePositive";
    case "not_my_product":
      return "resolveActions.notMyProduct";
    default:
      return "status.needsReview";
  }
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const alerts = await db.safetyAlert.findMany({
    where: { shop: session.shop },
    orderBy: { updatedAt: "desc" },
    take: 100,
  });

  return json({
    records: alerts.map((alert: any) => ({
      id: alert.id,
      productTitle: alert.productTitle,
      productId: alert.productId,
      status: alert.status,
      resolutionType: alert.resolutionType || null,
      notes: alert.notes || null,
      updatedAt: alert.updatedAt,
      resolvedAt: alert.resolvedAt || null,
      dismissedAt: alert.dismissedAt || null,
      ...parseAlertSummary(alert.checkResult),
    })),
  });
};

export default function EvidencePage() {
  const { records } = useLoaderData<typeof loader>();
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const dateLocale = i18n.language === "sk" ? "sk-SK" : "en-GB";

  return (
    <s-page size="large" className="page-shell" suppressHydrationWarning>
      <s-heading slot="title" size="large" suppressHydrationWarning>{t("evidence.title")}</s-heading>
      <s-button slot="primary-action" variant="primary" href="/app/audit-report" suppressHydrationWarning>
        {t("actions.downloadAuditReport")}
      </s-button>

      <div className="admin-stack">
        <section className="admin-card">
          <div className="admin-card__header">
            <div>
              <p className="admin-eyebrow">{t("evidence.eyebrow")}</p>
              <h2 className="admin-card__title">{t("evidence.heading")}</h2>
              <p className="admin-card__description">{t("evidence.description")}</p>
            </div>
            <s-badge tone="info">{t("evidence.records", { count: records.length })}</s-badge>
          </div>
        </section>

        <section className="admin-card">
          <s-table accessibilityLabel={t("evidence.table.accessibilityLabel")}>
            <s-table-header-row>
              <s-table-header listSlot="primary">{t("evidence.table.product")}</s-table-header>
              <s-table-header listSlot="inline">{t("evidence.table.status")}</s-table-header>
              <s-table-header listSlot="labeled">{t("evidence.table.decision")}</s-table-header>
              <s-table-header>{t("evidence.table.notes")}</s-table-header>
              <s-table-header>{t("evidence.table.updated")}</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {records.length === 0 ? (
                <s-table-row>
                  <s-table-cell colSpan={5}>
                    <s-box padding="large">
                      <s-text tone="subdued">{t("evidence.empty")}</s-text>
                    </s-box>
                  </s-table-cell>
                </s-table-row>
              ) : records.map((record: any) => (
                <s-table-row key={record.id}>
                  <s-table-cell>
                    <s-stack gap="small-100">
                      <s-link onClick={() => navigate(`/app/alerts?search=${encodeURIComponent(record.productTitle)}`)}>
                        {record.productTitle}
                      </s-link>
                      {record.alertNumber ? (
                        <s-text tone="subdued" size="small">{t("evidence.alertNumber", { number: record.alertNumber })}</s-text>
                      ) : null}
                    </s-stack>
                  </s-table-cell>
                  <s-table-cell>
                    <s-badge tone={record.status === "active" ? "critical" : record.status === "resolved" ? "success" : "info"}>
                      {record.status === "active"
                        ? t("status.needsReview")
                        : record.status === "resolved"
                          ? t("status.resolved")
                          : t("status.dismissed")}
                    </s-badge>
                  </s-table-cell>
                  <s-table-cell>
                    <s-stack gap="small-100">
                      <s-text>{t(resolutionLabelKey(record.resolutionType))}</s-text>
                      {record.riskLevel ? <s-text tone="subdued" size="small">{record.riskLevel}</s-text> : null}
                    </s-stack>
                  </s-table-cell>
                  <s-table-cell>
                    <div className="evidence-note">
                      <s-text>{record.notes || record.reason || t("evidence.noNotes")}</s-text>
                    </div>
                  </s-table-cell>
                  <s-table-cell>
                    <s-text>{formatRelativeDate(new Date(record.updatedAt), t, dateLocale)}</s-text>
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        </section>
      </div>
    </s-page>
  );
}
