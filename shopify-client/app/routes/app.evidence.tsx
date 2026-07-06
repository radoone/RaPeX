import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useNavigate } from "@remix-run/react";
import { useTranslation } from "react-i18next";
import { useMemo, useState } from "react";
import { authenticate } from "../shopify.server";
import db from "../merchant-db.server";
import { formatRelativeDate } from "../components/AlertTable";
import { requireActiveBilling } from "../services/billing.server";

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
  const { billing, session } = await authenticate.admin(request);
  const billingRedirect = await requireActiveBilling(billing, session.shop);
  if (billingRedirect) return billingRedirect as never;
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
  const [searchValue, setSearchValue] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [expandedRecords, setExpandedRecords] = useState<string[]>([]);
  const filteredRecords = useMemo(() => {
    const query = searchValue.trim().toLocaleLowerCase();
    return records.filter((record: any) => {
      const matchesStatus = statusFilter === "all" || record.status === statusFilter;
      const searchable = [record.productTitle, record.alertNumber, record.notes, record.reason]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase();
      return matchesStatus && (!query || searchable.includes(query));
    });
  }, [records, searchValue, statusFilter]);

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
            <s-badge tone="info">
              {filteredRecords.length === records.length
                ? t("evidence.records", { count: records.length })
                : t("evidence.filteredRecords", { visible: filteredRecords.length, total: records.length })}
            </s-badge>
          </div>
        </section>

        <section className="admin-card">
          <div className="admin-toolbar evidence-toolbar">
            <s-text-field
              label={t("evidence.filters.searchLabel")}
              labelAccessibilityVisibility="exclusive"
              icon="search"
              placeholder={t("evidence.filters.searchPlaceholder")}
              value={searchValue}
              onInput={(event: any) => setSearchValue(event.currentTarget.value || "")}
            />
            <s-select
              label={t("evidence.filters.statusLabel")}
              value={statusFilter}
              onChange={(event: any) => setStatusFilter(event.currentTarget.value || "all")}
            >
              <s-option value="all">{t("common.all")}</s-option>
              <s-option value="active">{t("status.needsReview")}</s-option>
              <s-option value="resolved">{t("status.resolved")}</s-option>
              <s-option value="dismissed">{t("status.dismissed")}</s-option>
            </s-select>
          </div>
          <s-table accessibilityLabel={t("evidence.table.accessibilityLabel")}>
            <s-table-header-row>
              <s-table-header listSlot="primary">{t("evidence.table.product")}</s-table-header>
              <s-table-header listSlot="inline">{t("evidence.table.status")}</s-table-header>
              <s-table-header listSlot="labeled">{t("evidence.table.decision")}</s-table-header>
              <s-table-header>{t("evidence.table.notes")}</s-table-header>
              <s-table-header>{t("evidence.table.updated")}</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {filteredRecords.length === 0 ? (
                <s-table-row>
                  <s-table-cell colSpan={5}>
                    <s-box padding="large">
                      <s-text tone="subdued">
                        {records.length === 0 ? t("evidence.empty") : t("evidence.filters.noResults")}
                      </s-text>
                    </s-box>
                  </s-table-cell>
                </s-table-row>
              ) : filteredRecords.map((record: any) => (
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
                    <div className={`evidence-note${expandedRecords.includes(record.id) ? " evidence-note--expanded" : ""}`}>
                      <s-text>{record.notes || record.reason || t("evidence.noNotes")}</s-text>
                    </div>
                    {(record.notes || record.reason) ? (
                      <s-button
                        variant="tertiary"
                        size="small"
                        accessibilityLabel={expandedRecords.includes(record.id)
                          ? t("evidence.filters.collapseForProduct", { title: record.productTitle })
                          : t("evidence.filters.expandForProduct", { title: record.productTitle })}
                        onClick={() => setExpandedRecords((current) => current.includes(record.id)
                          ? current.filter((id) => id !== record.id)
                          : [...current, record.id])}
                      >
                        {expandedRecords.includes(record.id) ? t("evidence.filters.showLess") : t("evidence.filters.showMore")}
                      </s-button>
                    ) : null}
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
