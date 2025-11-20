import { useEffect, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useFetcher, useLoaderData, useNavigation } from "@remix-run/react";
import { json } from "@remix-run/node";
import { useTranslation } from "react-i18next";
import {
  Page,
  Layout,
  Text,
  Card,
  Button,
  BlockStack,
  InlineStack,
  InlineGrid,
  EmptyState,
  Banner,
  Badge,
  Icon,
  ProgressBar,
  Divider,
  Tooltip,
  CalloutCard,
  SkeletonPage,
  SkeletonBodyText,
  SkeletonDisplayText,
} from "@shopify/polaris";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import {
  AlertTable,
  AlertDetailModal,
  SafetyGatePortal,
  LanguageSwitcher,
} from "../components";
import {
  AlertDiamondIcon,
  ChartVerticalIcon,
  ClipboardChecklistIcon,
  TargetIcon,
  InfoIcon,
} from "@shopify/polaris-icons";

type BulkCheckResults = {
  processed: number;
  checked: number;
  alertsCreated: number;
  errors: number;
  startTime: Date;
  endTime: Date | null;
};

// Remix serializes Date objects to strings, so we need a type for the client-side data
type SerializedBulkCheckResults = {
  processed: number;
  checked: number;
  alertsCreated: number;
  errors: number;
  startTime: string;
  endTime: string | null;
};

type ActionResponse = {
  success: boolean;
  message?: string;
  error?: string;
  results?: BulkCheckResults;
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  // Get dashboard stats
  const [activeAlerts, totalAlerts, totalChecks, recentAlerts] = await Promise.all([
    // Active alerts count
    db.safetyAlert.count({
      where: {
        shop: session.shop,
        status: 'active',
      },
    }),

    // Total alerts count
    db.safetyAlert.count({
      where: {
        shop: session.shop,
      },
    }),

    // Total checks count
    db.safetyCheck.count({
      where: {
        shop: session.shop,
      },
    }),

    // Recent alerts (last 10)
    db.safetyAlert.findMany({
      where: {
        shop: session.shop,
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: 10,
    }),
  ]);

  // Process alerts to extract alertType and riskDescription from checkResult
  const processedRecentAlerts = recentAlerts.map((alert: any) => {
    let alertType = undefined;
    let riskDescription = undefined;

    try {
      if (alert.checkResult) {
        const checkResult = JSON.parse(alert.checkResult);
        if (checkResult.warnings && checkResult.warnings.length > 0) {
          const firstWarning = checkResult.warnings[0];
          alertType = firstWarning.alertType || firstWarning.alertDetails?.fields?.alert_type;
          riskDescription = firstWarning.riskLegalProvision || firstWarning.alertDetails?.fields?.risk_legal_provision;
        }
      }
    } catch (error) {
      console.error('Error parsing checkResult for alert', alert.id, error);
    }

    return {
      ...alert,
      alertType,
      riskDescription,
    };
  });

  return json({
    stats: {
      activeAlerts,
      totalAlerts,
      totalChecks,
    },
    recentAlerts: processedRecentAlerts,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const action = formData.get("action");

  if (action === "dismissAlert") {
    const alertId = formData.get("alertId") as string;
    const notes = formData.get("notes") as string;

    await db.safetyAlert.update({
      where: { id: alertId },
      data: {
        status: 'dismissed',
        dismissedAt: new Date(),
        dismissedBy: session.id,
        notes: notes || undefined,
      },
    });

    return json({ success: true, message: "Alert dismissed" });
  }

  if (action === "resolveAlert") {
    const alertId = formData.get("alertId") as string;
    const notes = formData.get("notes") as string;

    await db.safetyAlert.update({
      where: { id: alertId },
      data: {
        status: 'resolved',
        resolvedAt: new Date(),
        notes: notes || undefined,
      },
    });

    return json({ success: true, message: "Alert resolved" });
  }

  if (action === "reactivateAlert") {
    const alertId = formData.get("alertId") as string;

    await db.safetyAlert.update({
      where: { id: alertId },
      data: {
        status: 'active',
        dismissedAt: null,
        dismissedBy: null,
        resolvedAt: null,
        notes: null,
      },
    });

    return json({ success: true, message: "Alert reactivated" });
  }

  if (action === "bulkCheck") {
    try {
      const { admin } = await authenticate.admin(request);

      // Import the bulk check function
      const { bulkCheckProducts } = await import("../services/safety-gate-checker.server");

      // Run bulk check
      const results = await bulkCheckProducts(admin, session.shop, db);

      return json({
        success: true,
        message: `Bulk check completed: ${results.processed} products processed, ${results.alertsCreated} alerts created`,
        results
      });
    } catch (error) {
      console.error('Bulk check failed:', error);
      return json({
        success: false,
        error: error instanceof Error ? error.message : 'Bulk check failed'
      }, { status: 500 });
    }
  }

  return json({ error: "Invalid action" }, { status: 400 });
};

export default function Index() {
  const { stats, recentAlerts } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<ActionResponse>();
  const navigation = useNavigation();
  const shopify = useAppBridge();
  const { t } = useTranslation();

  const [selectedAlert, setSelectedAlert] = useState<any>(null);
  const [modalOpen, setModalOpen] = useState(false);

  const isLoading = navigation.state === "loading";
  const isSubmitting = fetcher.state === "submitting";

  const resolvedAlerts = Math.max(stats.totalAlerts - stats.activeAlerts, 0);
  const resolutionRate = stats.totalAlerts > 0
    ? Math.round((resolvedAlerts / stats.totalAlerts) * 100)
    : 100;

  const scrollToSection = (id: string) => {
    const element = document.getElementById(id);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth' });
    }
  };

  const statCards = [
    {
      id: 'active-alerts',
      title: t('dashboard.stats.activeAlerts'),
      value: stats.activeAlerts,
      description: stats.activeAlerts === 0
        ? t('dashboard.stats.descriptions.activeAlertsZero')
        : t('dashboard.stats.descriptions.activeAlerts'),
      icon: AlertDiamondIcon,
      iconTone: stats.activeAlerts > 0 ? 'critical' : 'success',
      badge: stats.activeAlerts === 0 ? t('dashboard.stats.allClear') : t('dashboard.stats.open', { count: stats.activeAlerts }),
      badgeTone: stats.activeAlerts > 0 ? 'critical' : 'success',
      background: stats.activeAlerts > 0 ? 'bg-surface-critical' : 'bg-surface-success',
      action: () => scrollToSection('recent-alerts-card'),
    },
    {
      id: 'total-alerts',
      title: t('dashboard.stats.alertsLogged'),
      value: stats.totalAlerts,
      description: stats.totalAlerts === 0
        ? t('dashboard.stats.descriptions.alertsLoggedZero')
        : t('dashboard.stats.descriptions.alertsLogged'),
      icon: ChartVerticalIcon,
      iconTone: 'warning',
      badge: stats.totalAlerts > 0 ? t('dashboard.stats.resolved', { count: resolvedAlerts }) : t('dashboard.stats.newSetup'),
      badgeTone: stats.totalAlerts > 0 ? 'success' : 'info',
      background: 'bg-surface-warning',
      progress: resolutionRate,
      progressTone: resolvedAlerts > 0 ? 'success' : 'primary',
      progressLabel: stats.totalAlerts > 0
        ? `${resolutionRate}%`
        : '',
      action: () => scrollToSection('recent-alerts-card'),
    },
    {
      id: 'products-checked',
      title: t('dashboard.stats.productsChecked'),
      value: stats.totalChecks,
      description: stats.totalChecks === 0
        ? t('dashboard.stats.descriptions.productsCheckedZero')
        : t('dashboard.stats.descriptions.productsChecked'),
      icon: ClipboardChecklistIcon,
      iconTone: stats.totalChecks > 0 ? 'primary' : 'subdued',
      badge: stats.totalChecks === 0 ? t('dashboard.stats.actionNeeded') : t('dashboard.stats.autoMonitoring'),
      badgeTone: stats.totalChecks === 0 ? 'warning' : 'success',
      background: 'bg-surface-emphasis',
      action: () => scrollToSection('bulk-check-card'),
    },
  ] as const;

  const dismissAlert = (alertId: string, notes: string = '') => {
    fetcher.submit(
      { action: 'dismissAlert', alertId, notes },
      { method: 'POST' }
    );
  };

  const resolveAlert = (alertId: string, notes: string = '') => {
    fetcher.submit(
      { action: 'resolveAlert', alertId, notes },
      { method: 'POST' }
    );
  };

  const reactivateAlert = (alertId: string) => {
    fetcher.submit(
      { action: 'reactivateAlert', alertId },
      { method: 'POST' }
    );
  };

  const viewDetails = (alert: any) => {
    setSelectedAlert(alert);
    setModalOpen(true);
  };

  const openFirstAlert = () => {
    if (recentAlerts.length === 0) {
      return;
    }
    setSelectedAlert(recentAlerts[0]);
    setModalOpen(true);
  };

  const runBulkCheck = () => {
    if (isSubmitting) return;
    if (confirm(t('common.confirm'))) {
      fetcher.submit(
        { action: 'bulkCheck' },
        { method: 'POST' }
      );
    }
  };

  const hasBulkCheckResults = (data: any): data is { success: boolean; message?: string; results: SerializedBulkCheckResults } => {
    return data?.success === true && data.results !== undefined;
  };

  const bulkResults = hasBulkCheckResults(fetcher.data) ? fetcher.data.results : null;
  const bulkCompletion = bulkResults
    ? Math.min(100, Math.round((bulkResults.checked / Math.max(bulkResults.processed, 1)) * 100))
    : 0;
  const bulkDuration = bulkResults && bulkResults.endTime
    ? Math.max(
      0,
      Math.round(
        (new Date(bulkResults.endTime).getTime() - new Date(bulkResults.startTime).getTime()) / 1000,
      ),
    )
    : 0;

  useEffect(() => {
    if (fetcher.data) {
      if (fetcher.data.success && fetcher.data.message) {
        shopify.toast.show(fetcher.data.message);
      } else if (!fetcher.data.success && fetcher.data.error) {
        shopify.toast.show(fetcher.data.error, { isError: true });
      }
    }
  }, [fetcher.data, shopify]);

  if (isLoading) {
    return (
      <SkeletonPage primaryAction>
        <Layout>
          <Layout.Section>
            <Card padding="400">
              <SkeletonBodyText lines={2} />
            </Card>
            <Card padding="400">
              <SkeletonDisplayText size="small" />
              <SkeletonBodyText lines={3} />
            </Card>
          </Layout.Section>
        </Layout>
      </SkeletonPage>
    );
  }

  return (
    <Page
      title={t('dashboard.title')}
      primaryAction={{
        content: t('dashboard.bulkCheck.action'),
        onAction: runBulkCheck,
        disabled: isSubmitting,
      }}
    >
      <Layout>
        <Layout.Section>
          <BlockStack gap="500">
            <InlineStack align="end" gap="200">
              <Tooltip
                content={
                  <BlockStack gap="200">
                    <BlockStack gap="050">
                      <Text as="p" fontWeight="bold">{t('dashboard.howItWorks.autoMonitoring.title')}</Text>
                      <Text as="p">{t('dashboard.howItWorks.autoMonitoring.description')}</Text>
                    </BlockStack>
                    <BlockStack gap="050">
                      <Text as="p" fontWeight="bold">{t('dashboard.howItWorks.alertGeneration.title')}</Text>
                      <Text as="p">{t('dashboard.howItWorks.alertGeneration.description')}</Text>
                    </BlockStack>
                  </BlockStack>
                }
                dismissOnMouseOut
              >
                <div style={{ cursor: 'help' }}>
                  <Icon source={InfoIcon} tone="base" />
                </div>
              </Tooltip>
              <LanguageSwitcher />
            </InlineStack>

            {stats.activeAlerts > 0 && (
              <Banner
                tone="critical"
                icon={AlertDiamondIcon}
                title={t('dashboard.activeAlertsBanner.title')}
                action={{
                  content: t('dashboard.activeAlertsBanner.reviewAction'),
                  onAction: openFirstAlert,
                  disabled: recentAlerts.length === 0,
                }}
                secondaryAction={{
                  content: t('dashboard.activeAlertsBanner.manualCheckAction'),
                  url: "/app/manual-check",
                }}
              >
                <p>
                  {t('dashboard.activeAlertsBanner.content', { count: stats.activeAlerts })}
                </p>
              </Banner>
            )}

            {(isSubmitting || bulkResults) && (
              <div id="bulk-check-card">
                <CalloutCard
                  title={t('dashboard.bulkCheck.title')}
                  illustration="https://cdn.shopify.com/s/assets/admin/checkout/settings-customizecart-705f57c725ac05be5a34ec20c05b94298cb8afd10aac7bd9c7ad02030f48cfa0.svg"
                  primaryAction={{
                    content: t('dashboard.bulkCheck.action'),
                    onAction: runBulkCheck,
                  }}
                >
                  <BlockStack gap="400">
                    <Text as="p">
                      {isSubmitting
                        ? 'Scanning your products against the Safety Gate database...'
                        : t('dashboard.bulkCheck.description')}
                    </Text>

                    {bulkResults && (
                      <BlockStack gap="200">
                        <Divider />
                        <InlineStack gap="200">
                          <Badge tone="info">{t('dashboard.bulkCheck.processed', { count: bulkResults.processed })}</Badge>
                          <Badge tone="success">{t('dashboard.bulkCheck.checked', { count: bulkResults.checked })}</Badge>
                          <Badge tone="warning">{t('dashboard.bulkCheck.alerts', { count: bulkResults.alertsCreated })}</Badge>
                          {bulkResults.errors > 0 && (
                            <Badge tone="critical">{t('dashboard.bulkCheck.errors', { count: bulkResults.errors })}</Badge>
                          )}
                        </InlineStack>
                        <ProgressBar progress={bulkCompletion} tone="primary" />
                        <InlineStack gap="200" blockAlign="center">
                          <Text as="p" variant="bodySm" tone="subdued">
                            {t('dashboard.bulkCheck.completed', { seconds: bulkDuration })}
                          </Text>
                          <Text as="p" variant="bodySm" tone="subdued">
                            {t('dashboard.bulkCheck.started', { date: new Date(bulkResults.startTime).toLocaleString('en-GB') })}
                          </Text>
                        </InlineStack>
                      </BlockStack>
                    )}
                  </BlockStack>
                </CalloutCard>
              </div>
            )}

            <InlineGrid columns={{ xs: 1, md: 3 }} gap="400">
              {statCards.map((stat) => (
                <Card key={stat.id} padding="400" roundedAbove="sm">
                  <div
                    role="button"
                    onClick={stat.action}
                    style={{ cursor: 'pointer', height: '100%' }}
                  >
                    <BlockStack gap="400">
                      <InlineStack align="space-between" blockAlign="start">
                        <BlockStack gap="200">
                          <Text as="h3" variant="headingSm" tone="subdued">
                            {stat.title}
                          </Text>
                          <Text as="p" variant="heading2xl">
                            {stat.value.toLocaleString()}
                          </Text>
                        </BlockStack>
                        <div style={{
                          backgroundColor: 'var(--p-color-bg-surface-secondary)',
                          borderRadius: 'var(--p-border-radius-200)',
                          padding: 'var(--p-space-200)'
                        }}>
                          <Icon source={stat.icon} tone={stat.iconTone} />
                        </div>
                      </InlineStack>

                      <BlockStack gap="200">
                        {'progress' in stat && stat.progress !== undefined ? (
                          <BlockStack gap="200">
                            <ProgressBar progress={stat.progress} tone={stat.progressTone ?? 'primary'} size="small" />
                            <Text as="p" variant="bodySm" tone="subdued">
                              {stat.progressLabel}
                            </Text>
                          </BlockStack>
                        ) : (
                          <Badge tone={stat.badgeTone}>{stat.badge}</Badge>
                        )}
                        <Text as="p" variant="bodySm" tone="subdued">
                          {stat.description}
                        </Text>
                      </BlockStack>
                    </BlockStack>
                  </div>
                </Card>
              ))}
            </InlineGrid>

          </BlockStack>
        </Layout.Section>
      </Layout>

      <Layout>
        <Layout.Section variant="fullWidth">
          <div id="recent-alerts-card">
            <Card padding="400" roundedAbove="sm">
              <BlockStack gap="300">
                <InlineStack align="space-between" blockAlign="center">
                  <InlineStack gap="200" blockAlign="center">
                    <Icon source={AlertDiamondIcon} tone="critical" />
                    <BlockStack gap="100">
                      <Text as="h2" variant="headingMd">
                        {t('dashboard.recentAlerts.title')}
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        {t('dashboard.recentAlerts.description')}
                      </Text>
                    </BlockStack>
                  </InlineStack>
                  <Badge tone={stats.activeAlerts > 0 ? 'critical' : 'success'}>
                    {stats.activeAlerts > 0 ? t('dashboard.recentAlerts.active', { count: stats.activeAlerts }) : t('dashboard.recentAlerts.allResolved')}
                  </Badge>
                </InlineStack>

                {recentAlerts.length === 0 ? (
                  <EmptyState
                    heading={t('dashboard.recentAlerts.emptyState.heading')}
                    image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                  >
                    <p>
                      {t('dashboard.recentAlerts.emptyState.content')}
                    </p>
                  </EmptyState>
                ) : (
                  <AlertTable
                    alerts={recentAlerts}
                    onViewDetails={viewDetails}
                    onDismiss={(alertId) => dismissAlert(alertId)}
                    onResolve={(alertId) => resolveAlert(alertId)}
                    onReactivate={(alertId) => reactivateAlert(alertId)}
                    isLoading={isSubmitting}
                    showProductLink={true}
                  />
                )}
              </BlockStack>
            </Card>
          </div>
        </Layout.Section>
      </Layout>

      <Layout>
        <Layout.Section variant="oneThird">
          <Card padding="400" roundedAbove="sm">
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                {t('dashboard.quickActions.title')}
              </Text>
              <BlockStack gap="200">
                <Button
                  variant="plain"
                  textAlign="left"
                  url="/app/manual-check"
                  icon={ClipboardChecklistIcon}
                >
                  {t('dashboard.quickActions.manualCheck')}
                </Button>
                <Button
                  variant="plain"
                  textAlign="left"
                  target="_blank"
                  url="https://ec.europa.eu/safety-gate-alerts/screen/home"
                  icon={TargetIcon}
                >
                  {t('dashboard.quickActions.browsePortal')}
                </Button>
              </BlockStack>
            </BlockStack>
          </Card>
        </Layout.Section>
        <Layout.Section>
          <SafetyGatePortal />
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
