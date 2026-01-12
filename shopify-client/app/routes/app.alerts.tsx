import { useState, useCallback } from "react";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { useLoaderData, useFetcher, useNavigate } from "@remix-run/react";
import { json } from "@remix-run/node";
import { useTranslation } from "react-i18next";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import {
  AlertTable,
  AlertDetailModal,
  SafetyGatePortal,
  PageHeader,
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

  const [rawAlerts, totalCount, activeCount, resolvedCount, dismissedCount] = await Promise.all([
    db.safetyAlert.findMany({ where: whereClause, orderBy: { createdAt: 'desc' }, skip: offset, take: pageSize }),
    db.safetyAlert.count({ where: whereClause }),
    db.safetyAlert.count({ where: { shop: session.shop, status: 'active' } }),
    db.safetyAlert.count({ where: { shop: session.shop, status: 'resolved' } }),
    db.safetyAlert.count({ where: { shop: session.shop, status: 'dismissed' } }),
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
    let alertType = 'Unknown', riskDescription = '', alertDetails = null, riskLevelFromResult = null;
    try {
      const checkResult = JSON.parse(alert.checkResult);
      const warnings = Array.isArray(checkResult?.warnings) ? checkResult.warnings : [];
      if (warnings.length > 0) {
        const first = warnings[0];
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
      ...alert, alertType, riskDescription, alertDetails,
      riskLevel: effectiveRiskLevel,
      productImage: productImages[alert.productId] || productImages[`gid://shopify/Product/${alert.productId}`] || alertDetails?.fallbackImage || null,
    };
  });

  return json({
    alerts,
    pagination: { currentPage: page, totalPages: Math.ceil(totalCount / pageSize), totalCount, hasNext: page < Math.ceil(totalCount / pageSize), hasPrevious: page > 1 },
    filters: { status: statusFilters, riskLevel: riskLevelFilters, search },
    stats: { active: activeCount, resolved: resolvedCount, dismissed: dismissedCount, total: activeCount + resolvedCount + dismissedCount },
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const action = formData.get("action") as string;
  const alertId = formData.get("alertId") as string;
  const resolutionType = formData.get("resolutionType") as string | null;

  switch (action) {
    case "dismiss":
      await db.safetyAlert.update({
        where: { id: alertId },
        data: {
          status: 'dismissed',
          dismissedAt: new Date(),
          dismissedBy: session.id,
          resolutionType: resolutionType || undefined,
          notes: formData.get("notes") as string || undefined
        }
      });
      break;
    case "resolve":
      await db.safetyAlert.update({
        where: { id: alertId },
        data: {
          status: 'resolved',
          resolvedAt: new Date(),
          resolutionType: resolutionType || undefined,
          notes: formData.get("notes") as string || undefined
        }
      });
      break;
    case "reactivate":
      await db.safetyAlert.update({
        where: { id: alertId },
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

export default function AlertsPage() {
  const { alerts, pagination, filters, stats } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const navigate = useNavigate();
  const { t } = useTranslation();

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

  const resolvedRate = stats.total > 0 ? Math.round((stats.resolved / stats.total) * 100) : 0;

  return (
    <s-page size="large" className="page-shell">
      <PageHeader
        title={t('alerts.title')}
        subtitle={t('alerts.subtitle')}
        breadcrumbs={[
          { label: t('alerts.breadcrumbs.dashboard'), href: "/app" },
          { label: t('alerts.breadcrumbs.current') },
        ]}
        meta={(
          <>
            <s-badge tone={stats.active > 0 ? "critical" : "success"}>{t('alerts.meta.active', { count: stats.active })}</s-badge>
            <s-badge tone="info">{t('alerts.meta.total', { count: stats.total })}</s-badge>
          </>
        )}
        primaryAction={{ label: t('actions.manualCheck'), href: "/app/manual-check", variant: "primary" }}
        secondaryActions={[
          { label: t('actions.dashboard'), href: "/app", variant: "secondary" },
          { label: t('actions.settings'), href: "/app/settings", variant: "tertiary" },
        ]}
      />

      {/* Overview Metrics Cards - Shopify Style with Icons */}
      <s-section padding="base">
        <s-grid gridTemplateColumns="repeat(auto-fit, minmax(280px, 1fr))" gap="base">
          {/* Active Alerts Card */}
          <s-clickable
            onClick={() => navigate('/app/alerts?status=active')}
            border="base"
            borderRadius="large"
            padding="base"
            inlineSize="100%"
          >
            <s-grid gridTemplateColumns="auto 1fr" gap="base" alignItems="center">
              <s-box
                padding="small"
                borderRadius="full"
                background={stats.active > 0 ? "bg-fill-critical-secondary" : "bg-fill-success-secondary"}
                inlineSize="40px"
                blockSize="40px"
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >
                <s-text size="large">{stats.active > 0 ? "⚠️" : "✅"}</s-text>
              </s-box>
              <s-stack gap="small-200">
                <s-text tone="subdued" size="small">{t('alerts.metrics.activeHeading')}</s-text>
                <s-stack direction="inline" gap="small" blockAlign="center">
                  <s-heading size="large">{stats.active}</s-heading>
                  <s-badge tone={stats.active > 0 ? "critical" : "success"}>
                    {stats.active > 0 ? t('status.needsReview') : t('status.allClear')}
                  </s-badge>
                </s-stack>
                <s-text tone="subdued" size="small">{t('alerts.metrics.totalRecorded', { count: stats.total })}</s-text>
              </s-stack>
            </s-grid>
          </s-clickable>

          {/* Resolution Rate Card */}
          <s-clickable
            onClick={() => navigate('/app/alerts?status=resolved')}
            border="base"
            borderRadius="large"
            padding="base"
            inlineSize="100%"
          >
            <s-grid gridTemplateColumns="auto 1fr" gap="base" alignItems="center">
              <s-box
                padding="small"
                borderRadius="full"
                background="bg-fill-success-secondary"
                inlineSize="40px"
                blockSize="40px"
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >
                <s-text size="large">🎯</s-text>
              </s-box>
              <s-stack gap="small-200">
                <s-text tone="subdued" size="small">{t('alerts.metrics.resolutionHeading')}</s-text>
                <s-stack direction="inline" gap="small" blockAlign="center">
                  <s-heading size="large">{resolvedRate}%</s-heading>
                  <s-badge tone={resolvedRate >= 50 ? "success" : "warning"}>
                    {t('alerts.metrics.resolved', { count: stats.resolved })}
                  </s-badge>
                </s-stack>
                <s-text tone="subdued" size="small">{t('alerts.metrics.resolvedAndDismissed', { resolved: stats.resolved, dismissed: stats.dismissed })}</s-text>
              </s-stack>
            </s-grid>
          </s-clickable>

          {/* Dismissed/Archived Card */}
          <s-clickable
            onClick={() => navigate('/app/alerts?status=dismissed')}
            border="base"
            borderRadius="large"
            padding="base"
            inlineSize="100%"
          >
            <s-grid gridTemplateColumns="auto 1fr" gap="base" alignItems="center">
              <s-box
                padding="small"
                borderRadius="full"
                background="bg-fill-info-secondary"
                inlineSize="40px"
                blockSize="40px"
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >
                <s-text size="large">📁</s-text>
              </s-box>
              <s-stack gap="small-200">
                <s-text tone="subdued" size="small">{t('alerts.metrics.dismissedHeading')}</s-text>
                <s-stack direction="inline" gap="small" blockAlign="center">
                  <s-heading size="large">{stats.dismissed}</s-heading>
                  <s-badge tone="info">{t('alerts.metrics.archived')}</s-badge>
                </s-stack>
                <s-text tone="subdued" size="small">
                  {stats.dismissed === 0 ? t('alerts.metrics.dismissedDescriptionZero') : t('alerts.metrics.dismissedDescription')}
                </s-text>
              </s-stack>
            </s-grid>
          </s-clickable>
        </s-grid>
      </s-section>

      {/* Main Alerts Table - Shopify Index Table style */}
      <AlertTable
        alerts={alerts}
        onViewDetails={() => { }}
        onDismiss={(id, resolutionType) => handleAlertAction(id, 'dismiss', resolutionType)}
        onResolve={(id, resolutionType) => handleAlertAction(id, 'resolve', resolutionType)}
        onReactivate={(id) => handleAlertAction(id, 'reactivate')}
        isLoading={fetcher.state === 'submitting'}
        showProductLink
        modalIdPrefix="alert-detail"
        searchValue={searchValue}
        onSearchChange={(value) => {
          setSearchValue(value);
          // Debounced search - apply after typing stops
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

      {/* Pagination */}
      {pagination.totalPages > 1 && (
        <s-section padding="base">
          <s-stack direction="inline" align="space-between" blockAlign="center">
            <s-text tone="subdued">
              {t('pagination.pageOf', {
                current: pagination.currentPage,
                total: pagination.totalPages,
                count: pagination.totalCount
              })}
            </s-text>
            <s-stack direction="inline" gap="small">
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
            </s-stack>
          </s-stack>
        </s-section>
      )}

      <s-grid gap="base" gridTemplateColumns="1fr 1fr">
        <s-section heading={t('alerts.checklist.title')}>
          <s-stack gap="small">
            {[0, 1, 2].map((idx) => (
              <s-text key={idx}>• {t(`alerts.checklist.items.${idx}`)}</s-text>
            ))}
          </s-stack>
        </s-section>
        <SafetyGatePortal />
      </s-grid>

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
