import { useState, useCallback, useEffect } from "react";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useLoaderData, useFetcher, useNavigate, useRouteError, isRouteErrorResponse } from "react-router";
import { data as json } from "react-router";
import { useTranslation } from "react-i18next";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import db from "../merchant-db.server";
import {
  AlertTable,
  AlertDetailModal,
} from "../components";
import { requireActiveBilling } from "../services/billing.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { billing, session, admin } = await authenticate.admin(request);
  const billingRedirect = await requireActiveBilling(billing, session.shop);
  if (billingRedirect) return billingRedirect as never;

  const url = new URL(request.url);
  const page = parseInt(url.searchParams.get("page") || "1");
  const pageSize = 25;
  const offset = (page - 1) * pageSize;

  const showAllRecords = url.searchParams.get("view") === "all";
  const statusFilters = showAllRecords ? [] : url.searchParams.getAll("status");
  if (!showAllRecords && statusFilters.length === 0) {
    statusFilters.push("active");
  }
  const riskLevelFilters = url.searchParams.getAll("riskLevel");
  const search = url.searchParams.get("search") || undefined;
  const sortByParam = url.searchParams.get("sortBy") || "created";
  const sortOrderParam: "asc" | "desc" = url.searchParams.get("sortOrder") === "asc" ? "asc" : "desc";
  const sortField =
    sortByParam === "name"
      ? "productTitle"
      : sortByParam === "risk"
        ? "riskLevel"
        : "createdAt";
  const orderBy = { [sortField]: sortOrderParam };

  const whereClause: any = { shop: session.shop };
  if (statusFilters.length > 0) whereClause.status = statusFilters.length === 1 ? statusFilters[0] : { in: statusFilters };
  if (riskLevelFilters.length > 0) whereClause.riskLevel = riskLevelFilters.length === 1 ? riskLevelFilters[0] : { in: riskLevelFilters };
  // Prisma version here does not support `mode: 'insensitive'`; fallback to default contains
  if (search) whereClause.productTitle = { contains: search };

  const [rawAlerts, totalCount, activeCount, resolvedCount, dismissedCount, activeAlertRiskSample] = await Promise.all([
    db.safetyAlert.findMany({ where: whereClause, orderBy, skip: offset, take: pageSize }),
    db.safetyAlert.count({ where: whereClause }),
    db.safetyAlert.count({ where: { shop: session.shop, status: 'active' } }),
    db.safetyAlert.count({ where: { shop: session.shop, status: 'resolved' } }),
    db.safetyAlert.count({ where: { shop: session.shop, status: 'dismissed' } }),
    db.safetyAlert.findMany({
      where: { shop: session.shop, status: 'active' },
      select: { riskLevel: true, checkResult: true },
      take: 100,
    }),
  ]);

  const productIds = rawAlerts.map((a: any) => a.productId).filter(Boolean).map((id: string) =>
    id.startsWith('gid://shopify/Product/') ? id : `gid://shopify/Product/${id}`
  );

  const productImages: Record<string, string | null> = {};
  if (productIds.length > 0) {
    try {
      const response = await admin.graphql(`#graphql
        query getProductImages($ids: [ID!]!) {
          nodes(ids: $ids) { ... on Product { id featuredImage { url } } }
        }`, { variables: { ids: productIds } });
      const { data } = await response.json();
      data?.nodes?.forEach((node: any) => {
        if (node?.id) {
          const numericId = node.id.replace('gid://shopify/Product/', '');
          productImages[numericId] = node.featuredImage?.url || null;
          productImages[node.id] = node.featuredImage?.url || null;
        }
      });
    } catch (error) {
      console.error("Error fetching product images:", error);
    }
  }

  const alerts = rawAlerts.map((alert: any) => {
    let alertType = 'Unknown', riskDescription = '', alertDetails = null, riskLevelFromResult = null, overallSimilarity = null;
    try {
      const checkResult = JSON.parse(alert.checkResult);
      const warnings = Array.isArray(checkResult?.warnings) ? checkResult.warnings : [];
      if (warnings.length > 0) {
        const first = warnings[0];
        overallSimilarity = first.overallSimilarity || null;
        alertType = first.alertType || first.alertDetails?.fields?.alert_type || 'Unknown';
        riskDescription = first.riskLegalProvision || first.alertDetails?.fields?.risk_legal_provision || '';
        alertDetails = first.alertDetails || null;
        // Extract risk level from checkResult (more reliable than DB field for older records)
        riskLevelFromResult = first.alertDetails?.fields?.alert_level ||
          first.alertDetails?.fields?.risk_level ||
          first.riskLevel || null;
        const fields = first.alertDetails?.fields || {};
        const pics = [...(fields.pictures || []), fields.product_image].filter(Boolean);
        if (pics[0]) alertDetails = { ...alertDetails, fallbackImage: typeof pics[0] === 'string' ? pics[0] : pics[0].url };
      }
    } catch {
      // Ignore malformed legacy check payloads and fall back to stored alert fields.
    }
    // Prefer riskLevel from checkResult, fallback to DB field
    const effectiveRiskLevel = riskLevelFromResult || (alert.riskLevel !== 'unknown' ? alert.riskLevel : null) || 'Unknown';
    return {
      ...alert, alertType, riskDescription, alertDetails, overallSimilarity,
      riskLevel: effectiveRiskLevel,
      productImage: productImages[alert.productId] || productImages[`gid://shopify/Product/${alert.productId}`] || alertDetails?.fallbackImage || null,
    };
  });

  const criticalActiveAlerts = activeAlertRiskSample.filter((alert: any) => {
    try {
      const parsed = alert.checkResult ? JSON.parse(alert.checkResult) : null;
      const warning = Array.isArray(parsed?.warnings) ? parsed.warnings[0] : null;
      const level = String(
        warning?.alertDetails?.fields?.alert_level ||
        warning?.alertDetails?.fields?.risk_level ||
        warning?.riskLevel ||
        alert.riskLevel ||
        ""
      ).toLowerCase();
      return level.includes("serious") || level.includes("high") || level === "1" || level === "2";
    } catch {
      const level = String(alert.riskLevel || "").toLowerCase();
      return level.includes("serious") || level.includes("high") || level === "1" || level === "2";
    }
  }).length;

  return json({
    alerts,
    pagination: { currentPage: page, totalPages: Math.ceil(totalCount / pageSize), totalCount, hasNext: page < Math.ceil(totalCount / pageSize), hasPrevious: page > 1 },
    filters: { status: statusFilters, riskLevel: riskLevelFilters, search, sortBy: sortByParam, sortOrder: sortOrderParam, showAllRecords },
    stats: { active: activeCount, resolved: resolvedCount, dismissed: dismissedCount, total: activeCount + resolvedCount + dismissedCount, criticalActive: criticalActiveAlerts },
    shop: session.shop,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { billing, session } = await authenticate.admin(request);
  const billingRedirect = await requireActiveBilling(billing, session.shop);
  if (billingRedirect) return billingRedirect as never;
  const formData = await request.formData();
  const action = formData.get("action") as string;
  const alertId = formData.get("alertId") as string;
  const alertIdsJson = formData.get("alertIds") as string;
  const resolutionType = formData.get("resolutionType") as string | null;
  const notes = formData.get("notes") as string || undefined;

  const ids = alertIdsJson ? JSON.parse(alertIdsJson) as string[] : [alertId];
  const scopedWhere = { id: { in: ids.filter(Boolean) }, shop: session.shop };

  switch (action) {
    case "dismiss":
      await db.safetyAlert.updateMany({
        where: scopedWhere,
        data: {
          status: 'dismissed',
          dismissedAt: new Date(),
          dismissedBy: session.id,
          resolutionType: resolutionType || undefined,
          notes: notes
        }
      });
      break;
    case "resolve":
      await db.safetyAlert.updateMany({
        where: scopedWhere,
        data: {
          status: 'resolved',
          resolvedAt: new Date(),
          resolutionType: resolutionType || undefined,
          notes: notes
        }
      });
      break;
    case "reactivate":
      await db.safetyAlert.updateMany({
        where: scopedWhere,
        data: {
          status: 'active',
          dismissedAt: null,
          dismissedBy: null,
          resolvedAt: null,
          resolutionType: null
        }
      });
      break;
    default:
      return json({ success: false, error: "Invalid action" }, { status: 400 });
  }
  return json({ success: true });
};

export function ErrorBoundary() {
  const error = useRouteError();
  const { t } = useTranslation();

  const title = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : error instanceof Error
      ? error.message
      : t("common.unknown");

  return (
    <s-page suppressHydrationWarning>
      <s-heading slot="title" size="large" suppressHydrationWarning>{t("alerts.title")}</s-heading>
      <div className="admin-stack" style={{ marginTop: "var(--s-space-400)" }}>
        <s-banner tone="critical" heading={t("errors.pageLoadFailed")}>
          <s-text>{title}</s-text>
          <div style={{ marginTop: "var(--s-space-200)" }}>
            <s-button onClick={() => window.location.reload()} suppressHydrationWarning>
              {t("actions.retry")}
            </s-button>
          </div>
        </s-banner>
      </div>
    </s-page>
  );
}

export default function AlertsPage() {
  const { alerts, pagination, filters, stats, shop } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const shopify = useAppBridge();

  const [searchValue, setSearchValue] = useState(filters.search || '');
  const [statusFilter, setStatusFilter] = useState<string[]>(filters.status || []);
  const [riskLevelFilter, setRiskLevelFilter] = useState<string[]>(filters.riskLevel || []);

  const applyFilters = useCallback((overrides?: { search?: string; status?: string[]; riskLevel?: string[]; page?: number; sortBy?: string; sortOrder?: string }) => {
    const params = new URLSearchParams();
    const s = (overrides?.search ?? searchValue).trim();
    if (s) params.set('search', s);
    
    // Status filters
    const statusVal = overrides && Object.prototype.hasOwnProperty.call(overrides, 'status') ? overrides.status : statusFilter;
    statusVal?.forEach(v => params.append('status', v));
    if (statusVal?.length === 0) params.set('view', 'all');

    // Risk level filters
    const riskVal = overrides && Object.prototype.hasOwnProperty.call(overrides, 'riskLevel') ? overrides.riskLevel : riskLevelFilter;
    riskVal?.forEach(v => params.append('riskLevel', v));

    const sortBy = overrides?.sortBy ?? filters.sortBy;
    const sortOrder = overrides?.sortOrder ?? filters.sortOrder;
    if (sortBy && sortBy !== "created") params.set("sortBy", sortBy);
    if (sortOrder && sortOrder !== "desc") params.set("sortOrder", sortOrder);
    const p = overrides?.page ?? 1;
    if (p > 1) params.set('page', p.toString());
    const queryString = params.toString();
    navigate(queryString ? `/app/alerts?${queryString}` : '/app/alerts');
  }, [filters.sortBy, filters.sortOrder, searchValue, statusFilter, riskLevelFilter, navigate]);

  const handleAlertAction = useCallback((alertId: string, action: string, resolutionType?: string, notes?: string) => {
    fetcher.submit({ action, alertId, resolutionType: resolutionType || '', notes: notes || '' }, { method: 'POST' });
  }, [fetcher]);

  const handleBulkAction = useCallback((alertIds: string[], action: string, resolutionType?: string) => {
    fetcher.submit({ 
      action, 
      alertIds: JSON.stringify(alertIds), 
      resolutionType: resolutionType || '' 
    }, { method: 'POST' });
  }, [fetcher]);

  useEffect(() => {
    setSearchValue(filters.search || '');
    setStatusFilter(filters.status || []);
    setRiskLevelFilter(filters.riskLevel || []);
  }, [filters]);

  useEffect(() => {
    if (fetcher.data?.success) {
      shopify.toast.show(t("alerts.toasts.updated"));
    }
  }, [fetcher.data, shopify, t]);

  return (
    <s-page size="large" className="page-shell" suppressHydrationWarning>
      <s-heading slot="title" size="large" suppressHydrationWarning>{t('alerts.title')}</s-heading>
      <s-button slot="primary-action" variant="primary" href="/app/manual-check" suppressHydrationWarning>
        {t('actions.manualCheck')}
      </s-button>
      <s-button slot="secondary-actions" variant="secondary" href="/app/audit-report" suppressHydrationWarning>
        {t("actions.downloadAuditReport")}
      </s-button>
      <s-button slot="secondary-actions" variant="secondary" href="/app/evidence" suppressHydrationWarning>
        {t("actions.viewEvidence")}
      </s-button>

      <div className="admin-stack">
        {stats.active > 0 && (
          <s-banner
            tone={stats.criticalActive > 0 ? "critical" : "warning"}
            heading={stats.criticalActive > 0
              ? t("alerts.admin.criticalBannerTitle", { count: stats.active })
              : t("alerts.admin.warningBannerTitle", { count: stats.active })}
          >
            <s-text>
              {stats.criticalActive > 0
                ? t("alerts.admin.criticalBannerDescription", { count: stats.criticalActive })
                : t("alerts.admin.warningBannerDescription")}
            </s-text>
            <div style={{ marginTop: "var(--s-space-200)" }}>
              <s-button variant="primary" onClick={() => applyFilters({ status: ["active"] })}>
                {t("actions.reviewAlerts")}
              </s-button>
            </div>
          </s-banner>
        )}

        <section className="admin-card">
          <div className="admin-card__header">
            <div>
              <p className="admin-eyebrow">{t("alerts.admin.queue")}</p>
              <h2 className="admin-card__title">{t('alerts.subtitle')}</h2>
              <p className="admin-card__description">
                {t("alerts.admin.queueDescription")}
              </p>
            </div>
            <div className="admin-inline-meta">
              <s-badge tone={stats.active > 0 ? "critical" : "success"}>{t('alerts.meta.active', { count: stats.active })}</s-badge>
              <s-badge tone="info">{t('alerts.meta.total', { count: stats.total })}</s-badge>
            </div>
          </div>

          <AlertTable
            alerts={alerts}
            onViewDetails={() => { }}
            onDismiss={(id, resolutionType) => handleAlertAction(id, 'dismiss', resolutionType)}
            onResolve={(id, resolutionType) => handleAlertAction(id, 'resolve', resolutionType)}
            onReactivate={(id) => handleAlertAction(id, 'reactivate')}
            onBulkAction={handleBulkAction}
            isLoading={fetcher.state === 'submitting'}
            showProductLink
            modalIdPrefix="alert-detail"
            searchValue={searchValue}
            onSearchChange={(value) => {
              setSearchValue(value);
              setTimeout(() => applyFilters({ search: value }), 300);
            }}
            statusFilter={statusFilter}
            onStatusChange={(status) => {
              const newFilter = status ? [status] : [];
              setStatusFilter(newFilter);
              setRiskLevelFilter([]);
              applyFilters({ status: newFilter, riskLevel: [] });
            }}
            sortBy={filters.sortBy}
            sortOrder={filters.sortOrder}
            onSortChange={(sortBy, sortOrder) => applyFilters({ sortBy, sortOrder })}
            stats={stats}
          />
        </section>

        {pagination.totalPages > 1 && (
          <section className="admin-card">
            <div className="admin-card__header">
              <p className="admin-card__description">
                {t('pagination.pageOf', {
                  current: pagination.currentPage,
                  total: pagination.totalPages,
                  count: pagination.totalCount
                })}
              </p>
              <div className="admin-actions">
                <s-button
                  variant="secondary"
                  onClick={() => applyFilters({ page: pagination.currentPage - 1 })}
                  disabled={!pagination.hasPrevious || undefined}
                >
                  {t('actions.previous')}
                </s-button>
                <s-button
                  variant="secondary"
                  onClick={() => applyFilters({ page: pagination.currentPage + 1 })}
                  disabled={!pagination.hasNext || undefined}
                >
                  {t('actions.next')}
                </s-button>
              </div>
            </div>
          </section>
        )}
      </div>

      {/* Render a modal for each alert - s-modal uses commandFor to open */}
      {alerts.map((alert) => (
        <AlertDetailModal
          key={alert.id}
          alert={{ ...alert, shop: alert.shop || shop }}
          modalId={`alert-detail-${alert.id}`}
          onDismiss={(id, resolutionType, notes) => handleAlertAction(id, 'dismiss', resolutionType, notes)}
          onResolve={(id, resolutionType, notes) => handleAlertAction(id, 'resolve', resolutionType, notes)}
          onReactivate={(id) => handleAlertAction(id, 'reactivate')}
          isLoading={fetcher.state === 'submitting'}
        />
      ))}
    </s-page>
  );
}
