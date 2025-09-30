import { useState, useCallback } from "react";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { useLoaderData, useFetcher } from "@remix-run/react";
import { json } from "@remix-run/node";
import {
  Page,
  Layout,
  Card,
  Text,
  InlineStack,
  InlineGrid,
  BlockStack,
  EmptyState,
  Pagination,
  Badge,
  Button,
  Icon,
  Divider,
  ProgressBar,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import {
  AlertFilters,
  AlertTable,
  AlertDetailModal,
  SafetyGatePortal,
} from "../components";
import {
  AlertDiamondIcon,
  CheckCircleIcon,
  ClipboardChecklistIcon,
  HideIcon,
} from "@shopify/polaris-icons";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const url = new URL(request.url);
  const page = parseInt(url.searchParams.get("page") || "1");
  const pageSize = 25;
  const offset = (page - 1) * pageSize;

  // Filters
  const statusFilters = url.searchParams.getAll("status");
  const riskLevelFilters = url.searchParams.getAll("riskLevel");
  const search = url.searchParams.get("search") || undefined;

  const whereClause: any = {
    shop: session.shop,
  };

  if (statusFilters.length > 0) {
    whereClause.status = statusFilters.length === 1 ? statusFilters[0] : { in: statusFilters };
  }

  if (riskLevelFilters.length > 0) {
    whereClause.riskLevel = riskLevelFilters.length === 1 ? riskLevelFilters[0] : { in: riskLevelFilters };
  }

  if (search) {
    whereClause.productTitle = {
      contains: search,
      mode: 'insensitive',
    };
  }

  const [rawAlerts, totalCount, activeCount, resolvedCount, dismissedCount] = await Promise.all([
    db.safetyAlert.findMany({
      where: whereClause,
      orderBy: {
        createdAt: 'desc',
      },
      skip: offset,
      take: pageSize,
    }),
    db.safetyAlert.count({
      where: whereClause,
    }),
    db.safetyAlert.count({
      where: {
        shop: session.shop,
        status: 'active',
      },
    }),
    db.safetyAlert.count({
      where: {
        shop: session.shop,
        status: 'resolved',
      },
    }),
    db.safetyAlert.count({
      where: {
        shop: session.shop,
        status: 'dismissed',
      },
    }),
  ]);

  // Process alerts to extract alertType, riskDescription, and alertDetails from checkResult
  const alerts = rawAlerts.map((alert: any) => {
    let alertType = 'Unknown';
    let riskDescription = '';
    let alertDetails = null;

    try {
      const checkResult = JSON.parse(alert.checkResult);
      if (checkResult.warnings && checkResult.warnings.length > 0) {
        const firstWarning = checkResult.warnings[0];
        alertType = firstWarning.alertType || firstWarning.alertDetails?.fields?.alert_type || 'Unknown';
        riskDescription = firstWarning.riskLegalProvision || firstWarning.alertDetails?.fields?.risk_legal_provision || '';
        alertDetails = firstWarning.alertDetails || null;

        console.log('Parsed alert data:', {
          alertId: alert.id,
          alertType,
          riskDescription: riskDescription?.substring(0, 100),
          hasAlertDetails: !!alertDetails,
          alertDetailsFields: alertDetails?.fields ? Object.keys(alertDetails.fields) : []
        });
      }
    } catch (error) {
      console.error('Error parsing checkResult for alert', alert.id, error);
    }

    return {
      ...alert,
      alertType,
      riskDescription,
      alertDetails,
    };
  });

  const totalPages = Math.ceil(totalCount / pageSize);

  return json({
    alerts,
    pagination: {
      currentPage: page,
      totalPages,
      totalCount,
      hasNext: page < totalPages,
      hasPrevious: page > 1,
    },
    filters: {
      status: statusFilters,
      riskLevel: riskLevelFilters,
      search,
    },
    stats: {
      active: activeCount,
      resolved: resolvedCount,
      dismissed: dismissedCount,
      total: activeCount + resolvedCount + dismissedCount,
    },
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const action = formData.get("action") as string;
  const alertId = formData.get("alertId") as string;

  switch (action) {
    case "dismiss":
      await db.safetyAlert.update({
        where: { id: alertId },
        data: {
          status: 'dismissed',
          dismissedAt: new Date(),
          dismissedBy: session.id,
          notes: formData.get("notes") as string || undefined,
        },
      });
      break;

    case "resolve":
      await db.safetyAlert.update({
        where: { id: alertId },
        data: {
          status: 'resolved',
          resolvedAt: new Date(),
          notes: formData.get("notes") as string || undefined,
        },
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
        },
      });
      break;
  }

  return json({ success: true });
};

export default function AlertsPage() {
  const { alerts, pagination, filters, stats } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();

  const [selectedAlert, setSelectedAlert] = useState<any>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [searchValue, setSearchValue] = useState(filters.search || '');
  const [statusFilter, setStatusFilter] = useState<string[]>(filters.status || []);
  const [riskLevelFilter, setRiskLevelFilter] = useState<string[]>(filters.riskLevel || []);

  const viewAlertDetails = useCallback((alert: any) => {
    setSelectedAlert(alert);
    setModalOpen(true);
  }, []);

  const navigateWithParams = useCallback((params: URLSearchParams) => {
    const query = params.toString();
    window.location.search = query;
  }, []);

  const applyWithOverrides = useCallback(
    (overrides?: { search?: string; status?: string[]; risk?: string[]; page?: number }) => {
      const nextSearch = overrides?.search ?? searchValue;
      const nextStatus = overrides?.status ?? statusFilter;
      const nextRisk = overrides?.risk ?? riskLevelFilter;

      const params = new URLSearchParams();
      const trimmedSearch = nextSearch.trim();
      if (trimmedSearch.length > 0) {
        params.set('search', trimmedSearch);
      }
      nextStatus.forEach((status) => params.append('status', status));
      nextRisk.forEach((risk) => params.append('riskLevel', risk));

      const nextPage = overrides?.page ?? 1;
      if (nextPage > 1) {
        params.set('page', nextPage.toString());
      }

      navigateWithParams(params);
    },
    [navigateWithParams, riskLevelFilter, searchValue, statusFilter],
  );

  const handleSearchChange = useCallback((value: string) => {
    setSearchValue(value);
  }, []);

  const handleStatusFilterChange = useCallback((value: string[]) => {
    setStatusFilter(value);
  }, []);

  const handleRiskLevelFilterChange = useCallback((value: string[]) => {
    setRiskLevelFilter(value);
  }, []);

  const handleApplyFilters = useCallback(() => {
    applyWithOverrides({ page: 1 });
  }, [applyWithOverrides]);

  const handleClearFilters = useCallback(() => {
    setSearchValue('');
    setStatusFilter([]);
    setRiskLevelFilter([]);
    applyWithOverrides({ search: '', status: [], risk: [], page: 1 });
  }, [applyWithOverrides]);

  const handleAlertAction = useCallback((alertId: string, action: string, notes: string = '') => {
    fetcher.submit(
      { action, alertId, notes },
      { method: 'POST' },
    );
    setModalOpen(false);
  }, [fetcher]);

  const handlePageChange = useCallback((page: number) => {
    const safePage = Math.max(1, Math.min(page, Math.max(pagination.totalPages, 1)));
    applyWithOverrides({ page: safePage });
  }, [applyWithOverrides, pagination.totalPages]);

  const hasActiveFilters =
    searchValue.trim().length > 0 || statusFilter.length > 0 || riskLevelFilter.length > 0;

  const appliedFilters: { key: string; label: string; onRemove: () => void }[] = [];
  if (statusFilter.length > 0) {
    appliedFilters.push({
      key: 'status',
      label: `Status: ${statusFilter.join(', ')}`,
      onRemove: () => {
        setStatusFilter([]);
        applyWithOverrides({ status: [], page: 1 });
      },
    });
  }
  if (riskLevelFilter.length > 0) {
    appliedFilters.push({
      key: 'riskLevel',
      label: `Risk level: ${riskLevelFilter.join(', ')}`,
      onRemove: () => {
        setRiskLevelFilter([]);
        applyWithOverrides({ risk: [], page: 1 });
      },
    });
  }

  const filterComponent = (
    <AlertFilters
      searchValue={searchValue}
      statusFilter={statusFilter}
      riskLevelFilter={riskLevelFilter}
      appliedFilters={appliedFilters}
      onSearchChange={handleSearchChange}
      onStatusFilterChange={handleStatusFilterChange}
      onRiskLevelFilterChange={handleRiskLevelFilterChange}
      onClearFilters={handleClearFilters}
    />
  );

  const totalHistoricalAlerts = stats.total;
  const resolvedRate = totalHistoricalAlerts > 0
    ? Math.round((stats.resolved / totalHistoricalAlerts) * 100)
    : 0;

  const statCards = [
    {
      id: 'active',
      title: 'Active alerts',
      value: stats.active,
      description: stats.active === 0
        ? 'All alerts are currently resolved.'
        : 'Review these alerts and document remediation steps.',
      icon: AlertDiamondIcon,
      background: stats.active > 0 ? 'bg-surface-critical' : 'bg-surface-success',
      badge: stats.active > 0 ? `${stats.active} open` : 'All clear',
      badgeTone: stats.active > 0 ? 'critical' : 'success',
      iconTone: stats.active > 0 ? 'critical' : 'success',
    },
    {
      id: 'resolved',
      title: 'Resolved alerts',
      value: stats.resolved,
      description: stats.resolved === 0
        ? 'No alerts have been marked as resolved yet.'
        : 'Keep evidence of the actions you took for regulators.',
      icon: CheckCircleIcon,
      background: 'bg-surface-success',
      badge: totalHistoricalAlerts > 0 ? `${resolvedRate}% resolved` : undefined,
      badgeTone: 'success' as const,
      progress: resolvedRate,
      progressLabel: totalHistoricalAlerts > 0 ? `${resolvedRate}% of alerts resolved` : undefined,
      iconTone: 'success' as const,
    },
    {
      id: 'dismissed',
      title: 'Dismissed alerts',
      value: stats.dismissed,
      description: stats.dismissed === 0
        ? 'No alerts have been dismissed.'
        : 'Dismiss alerts after verifying products are compliant.',
      icon: HideIcon,
      background: 'bg-surface-secondary',
      badge: stats.dismissed > 0 ? `${stats.dismissed} archived` : undefined,
      badgeTone: 'attention' as const,
      iconTone: 'warning' as const,
    },
  ] as const;

  return (
    <Page>
      <TitleBar title="Safety Alerts" />

      <Layout>
        <Layout.Section>
          <BlockStack gap="500">
            <Card background="bg-surface-secondary" padding="400" roundedAbove="sm">
              <BlockStack gap="300">
                <InlineStack align="space-between" blockAlign="center">
                  <BlockStack gap="200">
                    <Text as="h1" variant="headingLg">
                      Stay ahead of product safety alerts
                    </Text>
                    <Text as="p" tone="subdued">
                      Track open alerts, capture resolutions, and keep your compliance trail audit ready.
                    </Text>
                  </BlockStack>
                  <InlineStack gap="200">
                    <Button
                      variant="primary"
                      icon={ClipboardChecklistIcon}
                      url="/app/manual-check"
                    >
                      Manual check
                    </Button>
                    <Button
                      variant="secondary"
                      icon={AlertDiamondIcon}
                      url="/app"
                    >
                      Dashboard
                    </Button>
                  </InlineStack>
                </InlineStack>
              </BlockStack>
            </Card>

            <InlineGrid columns={{ xs: 1, md: 3 }} gap="400">
              {statCards.map((stat) => (
                <Card key={stat.id} background={stat.background} padding="400" roundedAbove="sm">
                  <BlockStack gap="300">
                    <InlineStack align="space-between" blockAlign="center">
                      <Icon source={stat.icon} tone={stat.iconTone} />
                      {stat.badge && (
                        <Badge tone={stat.badgeTone}>{stat.badge}</Badge>
                      )}
                    </InlineStack>
                    <Text as="p" variant="heading2xl">
                      {stat.value.toLocaleString()}
                    </Text>
                    <Text as="p" tone="subdued">
                      {stat.description}
                    </Text>
                    {stat.progress !== undefined && (
                      <BlockStack gap="200">
                        <ProgressBar progress={stat.progress} tone="success" />
                        {stat.progressLabel && (
                          <Text as="p" variant="bodySm" tone="subdued">
                            {stat.progressLabel}
                          </Text>
                        )}
                      </BlockStack>
                    )}
                  </BlockStack>
                </Card>
              ))}
            </InlineGrid>

            <Card padding="400" roundedAbove="sm">
              <BlockStack gap="300">
                <InlineStack align="space-between" blockAlign="center">
                  <BlockStack gap="100">
                    <Text as="h2" variant="headingMd">
                      Alerts ({pagination.totalCount})
                    </Text>
                    <Text as="p" tone="subdued">
                      Filter and prioritise alerts before acting on affected products.
                    </Text>
                  </BlockStack>
                  <Badge tone={stats.active > 0 ? 'critical' : 'success'}>
                    {stats.active > 0 ? `${stats.active} active` : 'No active alerts'}
                  </Badge>
                </InlineStack>

                {filterComponent}

                <InlineStack align="end" gap="200">
                  <Button variant="tertiary" onClick={handleClearFilters} disabled={!hasActiveFilters}>
                    Clear filters
                  </Button>
                  <Button variant="primary" onClick={handleApplyFilters}>
                    Apply filters
                  </Button>
                </InlineStack>

                <Divider />

                {alerts.length === 0 ? (
                  <EmptyState
                    heading="No alerts found"
                    image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                  >
                    <p>No safety alerts match your current filters.</p>
                  </EmptyState>
                ) : (
                  <>
                    <AlertTable
                      alerts={alerts}
                      onViewDetails={viewAlertDetails}
                      onDismiss={(alertId) => handleAlertAction(alertId, 'dismiss')}
                      onResolve={(alertId) => handleAlertAction(alertId, 'resolve')}
                      onReactivate={(alertId) => handleAlertAction(alertId, 'reactivate')}
                      isLoading={fetcher.state === 'submitting'}
                      showProductLink
                    />

                    {pagination.totalPages > 1 && (
                      <Pagination
                        label={`Page ${pagination.currentPage} of ${pagination.totalPages}`}
                        hasPrevious={pagination.hasPrevious}
                        onPrevious={() => handlePageChange(pagination.currentPage - 1)}
                        hasNext={pagination.hasNext}
                        onNext={() => handlePageChange(pagination.currentPage + 1)}
                      />
                    )}
                  </>
                )}
              </BlockStack>
            </Card>
          </BlockStack>
        </Layout.Section>
      </Layout>

      <Layout>
        <Layout.Section variant="fullWidth">
          <BlockStack gap="400">
            <Card padding="400" roundedAbove="sm">
              <BlockStack gap="300">
                <InlineStack gap="200" blockAlign="center">
                  <Icon source={ClipboardChecklistIcon} tone="primary" />
                  <Text as="h2" variant="headingMd">
                    Response checklist
                  </Text>
                </InlineStack>
                <BlockStack gap="200">
                  <InlineStack gap="200" blockAlign="start">
                    <Icon source={AlertDiamondIcon} tone="critical" />
                    <Text as="p" variant="bodyMd">
                      Prioritise active alerts to pause selling risky products.
                    </Text>
                  </InlineStack>
                  <InlineStack gap="200" blockAlign="start">
                    <Icon source={CheckCircleIcon} tone="success" />
                    <Text as="p" variant="bodyMd">
                      Record every remediation step for your compliance log.
                    </Text>
                  </InlineStack>
                  <InlineStack gap="200" blockAlign="start">
                    <Icon source={HideIcon} tone="warning" />
                    <Text as="p" variant="bodyMd">
                      Dismiss alerts only after confirming the product is compliant.
                    </Text>
                  </InlineStack>
                </BlockStack>
              </BlockStack>
            </Card>

            <SafetyGatePortal />
          </BlockStack>
        </Layout.Section>
      </Layout>

      <AlertDetailModal
        alert={selectedAlert}
        open={modalOpen}
        onClose={() => setModalOpen(false)}
      />
    </Page>
  );
}
