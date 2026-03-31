import { useState, useCallback, useEffect } from "react";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { useLoaderData, useFetcher, useNavigate, useRouteError, isRouteErrorResponse } from "@remix-run/react";
import { json } from "@remix-run/node";
import { useTranslation } from "react-i18next";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import db from "../merchant-db.server";
import {
  AlertTable,
  AlertDetailModal,
  SummaryCard,
} from "../components";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);

  const url = new URL(request.url);
  const page = parseInt(url.searchParams.get("page") || "1");
  const pageSize = 25;
  const offset = (page - 1) * pageSize;

  const statusFilters = url.searchParams.getAll("status");
  const riskLevelFilters = url.searchParams.getAll("riskLevel");
  const search = url.searchParams.get("search") || undefined;

  const whereClause: any = { shop: session.shop };
  if (statusFilters.length > 0) whereClause.status = statusFilters.length === 1 ? statusFilters[0] : { in: statusFilters };
  if (riskLevelFilters.length > 0) whereClause.riskLevel = riskLevelFilters.length === 1 ? riskLevelFilters[0] : { in: riskLevelFilters };
  // Prisma version here does not support `mode: 'insensitive'`; fallback to default contains
  if (search) whereClause.productTitle = { contains: search };

  const [rawAlerts, totalCount, activeCount, resolvedCount, dismissedCount, activeAlertRiskSample] = await Promise.all([
    db.safetyAlert.findMany({ where: whereClause, orderBy: { createdAt: 'desc' }, skip: offset, take: pageSize }),
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
    } catch { }
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
    filters: { status: statusFilters, riskLevel: riskLevelFilters, search },
    stats: { active: activeCount, resolved: resolvedCount, dismissed: dismissedCount, total: activeCount + resolvedCount + dismissedCount, criticalActive: criticalActiveAlerts },
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const action = formData.get("action") as string;
  const alertId = formData.get("alertId") as string;
  const alertIdsJson = formData.get("alertIds") as string;
  const resolutionType = formData.get("resolutionType") as string | null;
  const notes = formData.get("notes") as string || undefined;

  const ids = alertIdsJson ? JSON.parse(alertIdsJson) as string[] : [alertId];

  switch (action) {
    case "dismiss":
      await db.safetyAlert.updateMany({
        where: { id: { in: ids }, shop: session.shop },
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
        where: { id: { in: ids }, shop: session.shop },
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
        where: { id: { in: ids }, shop: session.shop },
        data: {
          status: 'active',
          dismissedAt: null,
          dismissedBy: null,
          resolvedAt: null,
          resolutionType: null
        }
      });
      break;
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
    <s-page>
      <s-heading slot="title" size="large">{t("alerts.title")}</s-heading>
      <div className="admin-stack" style={{ marginTop: "var(--s-space-400)" }}>
        <s-banner tone="critical" heading={t("errors.pageLoadFailed")}>
          <s-text>{title}</s-text>
          <div style={{ marginTop: "var(--s-space-200)" }}>
            <s-button onClick={() => window.location.reload()}>
              {t("actions.retry")}
            </s-button>
          </div>
        </s-banner>
      </div>
    </s-page>
  );
}

export default function AlertsPage() {
  const { alerts, pagination, filters, stats } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const shopify = useAppBridge();

  const [searchValue, setSearchValue] = useState(filters.search || '');
  const [statusFilter, setStatusFilter] = useState<string[]>(filters.status || []);

  const applyFilters = useCallback((overrides?: { search?: string; status?: string[]; page?: number }) => {
    const params = new URLSearchParams();
    const s = (overrides?.search ?? searchValue).trim();
    if (s) params.set('search', s);
    (overrides?.status ?? statusFilter).forEach(v => params.append('status', v));
    const p = overrides?.page ?? 1;
    if (p > 1) params.set('page', p.toString());
    const queryString = params.toString();
    navigate(queryString ? `/app/alerts?${queryString}` : '/app/alerts');
  }, [searchValue, statusFilter, navigate]);

  const handleAlertAction = useCallback((alertId: string, action: string, resolutionType?: string) => {
    fetcher.submit({ action, alertId, resolutionType: resolutionType || '' }, { method: 'POST' });
  }, [fetcher]);

  const handleBulkAction = useCallback((alertIds: string[], action: string, resolutionType?: string) => {
    fetcher.submit({ 
      action, 
      alertIds: JSON.stringify(alertIds), 
      resolutionType: resolutionType || '' 
    }, { method: 'POST' });
  }, [fetcher]);

  const resolvedRate = stats.total > 0 ? Math.round((stats.resolved / stats.total) * 100) : 0;

  useEffect(() => {
    if (fetcher.data?.success) {
      shopify.toast.show(t("alerts.toasts.updated"));
    }
  }, [fetcher.data, shopify, t]);

  return (
    <s-page size="large" className="page-shell">
      <s-heading slot="title" size="large">{t('alerts.title')}</s-heading>
      <s-button slot="primary-action" variant="primary" href="/app/manual-check">
        {t('actions.manualCheck')}
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

        <section className="metric-grid">
          <SummaryCard
            title={t('alerts.metrics.activeHeading')}
            value={stats.active}
            badge={<s-badge tone={stats.active > 0 ? "critical" : "success"}>{stats.active > 0 ? t('status.needsReview') : t('status.allClear')}</s-badge>}
            description={t('alerts.metrics.totalRecorded', { count: stats.total })}
          />
          <SummaryCard
            title={t('alerts.metrics.resolutionHeading')}
            value={`${resolvedRate}%`}
            badge={<s-badge tone={resolvedRate >= 50 ? "success" : "warning"}>{t('alerts.metrics.resolved', { count: stats.resolved })}</s-badge>}
            description={t('alerts.metrics.resolvedAndDismissed', { resolved: stats.resolved, dismissed: stats.dismissed })}
            progress={resolvedRate}
            progressTone={resolvedRate >= 50 ? "success" : "warning"}
          />
        </section>

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
              applyFilters({ status: newFilter });
            }}
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
          alert={alert}
          modalId={`alert-detail-${alert.id}`}
          onDismiss={(id, resolutionType) => handleAlertAction(id, 'dismiss', resolutionType)}
          onResolve={(id, resolutionType) => handleAlertAction(id, 'resolve', resolutionType)}
          onReactivate={(id) => handleAlertAction(id, 'reactivate')}
          isLoading={fetcher.state === 'submitting'}
        />
      ))}
    </s-page>
  );
}
