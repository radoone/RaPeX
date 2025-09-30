import { useEffect, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useFetcher, useLoaderData } from "@remix-run/react";
import { json } from "@remix-run/node";
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
} from "@shopify/polaris";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import {
  AlertTable,
  AlertDetailModal,
  SafetyGatePortal,
} from "../components";
import {
  AlertDiamondIcon,
  ChartVerticalIcon,
  ClipboardChecklistIcon,
  ShieldCheckMarkIcon,
  TargetIcon,
  CheckCircleIcon,
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

  return json({
    stats: {
      activeAlerts,
      totalAlerts,
      totalChecks,
    },
    recentAlerts,
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
  const shopify = useAppBridge();

  const [selectedAlert, setSelectedAlert] = useState<any>(null);
  const [modalOpen, setModalOpen] = useState(false);

  const resolvedAlerts = Math.max(stats.totalAlerts - stats.activeAlerts, 0);
  const resolutionRate = stats.totalAlerts > 0
    ? Math.round((resolvedAlerts / stats.totalAlerts) * 100)
    : 100;

  const statCards = [
    {
      id: 'active-alerts',
      title: 'Active alerts',
      value: stats.activeAlerts,
      description: stats.activeAlerts === 0
        ? 'All safety issues are resolved.'
        : 'Review these products today to stay compliant.',
      icon: AlertDiamondIcon,
      iconTone: stats.activeAlerts > 0 ? 'critical' : 'success',
      badge: stats.activeAlerts === 0 ? 'All clear' : `${stats.activeAlerts} open`,
      badgeTone: stats.activeAlerts > 0 ? 'critical' : 'success',
      background: stats.activeAlerts > 0 ? 'bg-surface-critical' : 'bg-surface-success',
      tooltip: 'Active alerts block affected products in your catalog until you dismiss or resolve them.',
    },
    {
      id: 'total-alerts',
      title: 'Alerts logged',
      value: stats.totalAlerts,
      description: stats.totalAlerts === 0
        ? 'No historical alerts. Keep monitoring new products.'
        : 'Includes resolved and dismissed alerts for audit trail.',
      icon: ChartVerticalIcon,
      iconTone: 'warning',
      badge: stats.totalAlerts > 0 ? `${resolvedAlerts} resolved` : 'New setup',
      badgeTone: stats.totalAlerts > 0 ? 'success' : 'info',
      background: 'bg-surface-warning',
      progress: resolutionRate,
      progressTone: resolvedAlerts > 0 ? 'success' : 'primary',
      progressLabel: stats.totalAlerts > 0
        ? `${resolutionRate}% of alerts resolved`
        : 'Resolve alerts as they appear to stay compliant.',
      tooltip: 'Track how many safety issues have been processed and closed.',
    },
    {
      id: 'products-checked',
      title: 'Products checked',
      value: stats.totalChecks,
      description: stats.totalChecks === 0
        ? 'Run a bulk check to scan your current catalog.'
        : 'Automatic Shopify events continue to monitor updates.',
      icon: ClipboardChecklistIcon,
      iconTone: stats.totalChecks > 0 ? 'primary' : 'subdued',
      badge: stats.totalChecks === 0 ? 'Action needed' : 'Auto monitoring',
      badgeTone: stats.totalChecks === 0 ? 'warning' : 'success',
      background: 'bg-surface-emphasis',
      tooltip: 'Every time a product changes we log a safety check for your records.',
    },
  ] as const;

  const howItWorksItems = [
    "Products are automatically checked when they're created or updated",
    'Safety alerts are generated if matches are found in the Safety Gate database',
    'You can dismiss, resolve, or reactivate alerts to manage follow-up',
    'Bulk and manual checks keep your entire catalog covered',
  ] as const;

  const quickActions = [
    {
      id: 'manage-alerts',
      title: 'Manage safety alerts',
      description: 'Review open issues, capture resolutions, and keep a clear audit trail.',
      icon: AlertDiamondIcon,
      action: {
        label: 'Open alerts',
        url: '/app/alerts',
      },
    },
    {
      id: 'manual-check',
      title: 'Run a manual check',
      description: 'Scan an individual product when you need instant reassurance.',
      icon: ClipboardChecklistIcon,
      action: {
        label: 'Start manual check',
        url: '/app/manual-check',
      },
    },
    {
      id: 'safety-gate',
      title: 'Safety Gate portal',
      description: 'Search the EU database for deeper context and historic notices.',
      icon: TargetIcon,
      action: {
        label: 'Open portal',
        url: 'https://ec.europa.eu/safety-gate-alerts/screen/search?resetSearch=true',
        external: true as const,
      },
    },
  ];



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
    if (confirm('Are you sure you want to check all products in your store? This may take some time depending on the number of products.')) {
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
    if (fetcher.data && 'success' in fetcher.data && fetcher.data.success && fetcher.data.message) {
      shopify.toast.show(fetcher.data.message);
    }
  }, [fetcher.data, shopify]);

  return (
    <Page>
      <TitleBar title="Safety Gate EU" />

      <Layout>
        <Layout.Section>
          <BlockStack gap="500">
            {stats.activeAlerts > 0 && (
              <Banner
                tone="critical"
                icon={AlertDiamondIcon}
                title="Active safety alerts need attention"
                action={{
                  content: "Review first alert",
                  onAction: openFirstAlert,
                  disabled: recentAlerts.length === 0,
                }}
                secondaryAction={{
                  content: "Manual check",
                  url: "/app/manual-check",
                }}
              >
                <p>
                  Resolve {stats.activeAlerts} active {stats.activeAlerts === 1 ? 'alert' : 'alerts'} to keep affected
                  products available in your store.
                </p>
              </Banner>
            )}

            <Card background="bg-surface-secondary" padding="400" roundedAbove="sm">
              <BlockStack gap="300">
                <InlineStack align="space-between" blockAlign="center">
                  <BlockStack gap="200">
                    <Text as="h1" variant="headingLg">
                      Monitor product safety at a glance
                    </Text>
                    <Text as="p" tone="subdued">
                      Track alerts, run catalog checks, and keep regulators satisfied.
                    </Text>
                  </BlockStack>
                  <Button
                    variant="primary"
                    onClick={openFirstAlert}
                    disabled={recentAlerts.length === 0}
                  >
                    Review alerts
                  </Button>
                </InlineStack>
              </BlockStack>
            </Card>

            <InlineGrid columns={{ xs: 1, md: 3 }} gap="400">
              {statCards.map((stat) => (
                <Card key={stat.id} background={stat.background} padding="400" roundedAbove="sm">
                  <BlockStack gap="300">
                    <InlineStack align="space-between" blockAlign="center">
                      <Icon source={stat.icon} tone={stat.iconTone} />
                      <Tooltip content={stat.tooltip}>
                        <Badge tone={stat.badgeTone}>{stat.badge}</Badge>
                      </Tooltip>
                    </InlineStack>
                    <Text as="p" variant="heading2xl">
                      {stat.value.toLocaleString()}
                    </Text>
                    <Text as="p" tone="subdued">
                      {stat.description}
                    </Text>
                    {stat.progress !== undefined && (
                      <BlockStack gap="200">
                        <ProgressBar progress={stat.progress} tone={stat.progressTone ?? 'primary'} />
                        <Text as="p" variant="bodySm" tone="subdued">
                          {stat.progressLabel}
                        </Text>
                      </BlockStack>
                    )}
                  </BlockStack>
                </Card>
              ))}
            </InlineGrid>

            <InlineGrid columns={{ xs: 1, md: 3 }} gap="400">
              {quickActions.map((action) => (
                <Card key={action.id} padding="400" roundedAbove="sm" background="bg-surface">
                  <BlockStack gap="300">
                    <InlineStack gap="200" blockAlign="center">
                      <Icon source={action.icon} tone="primary" />
                      <Text as="h2" variant="headingMd">
                        {action.title}
                      </Text>
                    </InlineStack>
                    <Text as="p" tone="subdued">
                      {action.description}
                    </Text>
                    <Button
                      variant="primary"
                      url={action.action.url}
                      external={action.action.external}
                    >
                      {action.action.label}
                    </Button>
                  </BlockStack>
                </Card>
              ))}
            </InlineGrid>

          </BlockStack>
        </Layout.Section>
      </Layout>

      <Layout>
        <Layout.Section variant="fullWidth">
          <Card background="bg-surface-emphasis" padding="400" roundedAbove="sm">
            <BlockStack gap="300">
              <InlineStack align="space-between" blockAlign="start">
                <InlineStack gap="200" blockAlign="center">
                  <Icon source={ClipboardChecklistIcon} tone="primary" />
                  <BlockStack gap="100">
                      <Text as="h2" variant="headingMd">
                        Bulk safety check
                      </Text>
                      <Text as="p" tone="subdued">
                        Scan every product in your store against the Safety Gate database to catch hidden risks.
                      </Text>
                    </BlockStack>
                  </InlineStack>
                  <Button
                    variant="primary"
                    onClick={runBulkCheck}
                    loading={fetcher.state === 'submitting'}
                  >
                    Check all products
                  </Button>
                </InlineStack>

                {bulkResults && (
                  <BlockStack gap="200">
                    <Divider />
                    <InlineStack gap="200">
                      <Badge tone="info">Processed {bulkResults.processed.toLocaleString()}</Badge>
                      <Badge tone="success">Checked {bulkResults.checked.toLocaleString()}</Badge>
                      <Badge tone="warning">Alerts {bulkResults.alertsCreated.toLocaleString()}</Badge>
                      {bulkResults.errors > 0 && (
                        <Badge tone="critical">Errors {bulkResults.errors.toLocaleString()}</Badge>
                      )}
                    </InlineStack>
                    <ProgressBar progress={bulkCompletion} tone="primary" />
                    <InlineStack gap="200" blockAlign="center">
                      <Text as="p" variant="bodySm" tone="subdued">
                        Completed in {bulkDuration} seconds
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        Started {new Date(bulkResults.startTime).toLocaleString('en-GB')}
                      </Text>
                    </InlineStack>
                  </BlockStack>
                )}
              </BlockStack>
            </Card>
        </Layout.Section>
      </Layout>

      <Layout>
        <Layout.Section variant="fullWidth">
          <Card padding="400" roundedAbove="sm">
            <BlockStack gap="300">
              <InlineStack align="space-between" blockAlign="center">
                <InlineStack gap="200" blockAlign="center">
                  <Icon source={AlertDiamondIcon} tone="critical" />
                  <BlockStack gap="100">
                    <Text as="h2" variant="headingMd">
                      Recent safety alerts
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      Investigate the latest matches from Safety Gate before fulfilling orders.
                    </Text>
                  </BlockStack>
                </InlineStack>
                <Badge tone={stats.activeAlerts > 0 ? 'critical' : 'success'}>
                  {stats.activeAlerts > 0 ? `${stats.activeAlerts} active` : 'All resolved'}
                </Badge>
              </InlineStack>

              {recentAlerts.length === 0 ? (
                <EmptyState
                  heading="No safety alerts yet"
                  image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                >
                  <p>
                    Great news—no products are currently flagged. Keep monitoring to maintain compliance.
                  </p>
                </EmptyState>
              ) : (
                <AlertTable
                  alerts={recentAlerts}
                  onViewDetails={viewDetails}
                  onDismiss={(alertId) => dismissAlert(alertId)}
                  onResolve={(alertId) => resolveAlert(alertId)}
                  onReactivate={(alertId) => reactivateAlert(alertId)}
                  isLoading={fetcher.state === 'submitting'}
                  showProductLink={true}
                />
              )}
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>

      <Layout>
        <Layout.Section variant="fullWidth">
          <BlockStack gap="400">
            <InlineGrid columns={{ xs: 1, md: 2, lg: 3 }} gap="400">
              <Card padding="400" roundedAbove="sm">
                <BlockStack gap="300">
                  <InlineStack gap="200" blockAlign="center">
                    <Icon source={TargetIcon} tone="primary" />
                    <Text as="h2" variant="headingMd">
                      Next steps
                    </Text>
                  </InlineStack>
                  <BlockStack gap="200">
                    <InlineStack gap="200" blockAlign="center">
                      <Icon source={AlertDiamondIcon} tone="critical" />
                      <Text as="p" variant="bodyMd">
                        Resolve active alerts to unblock affected listings.
                      </Text>
                    </InlineStack>
                    <InlineStack gap="200" blockAlign="center">
                      <Icon source={ClipboardChecklistIcon} tone="success" />
                      <Text as="p" variant="bodyMd">
                        Run manual checks when sourcing or updating high-risk products.
                      </Text>
                    </InlineStack>
                    <InlineStack gap="200" blockAlign="center">
                      <Icon source={ShieldCheckMarkIcon} tone="success" />
                      <Text as="p" variant="bodyMd">
                        Document outcomes to show regulators your due diligence.
                      </Text>
                    </InlineStack>
                  </BlockStack>
                  <InlineStack gap="200" wrap>
                    <Button variant="secondary" size="slim" url="/app/manual-check">
                      Go to manual check
                    </Button>
                    <Button
                      variant="tertiary"
                      size="slim"
                      external
                      url="https://ec.europa.eu/safety-gate-alerts/screen/home"
                    >
                      Safety Gate guidance
                    </Button>
                  </InlineStack>
                </BlockStack>
              </Card>

              <Card padding="400" roundedAbove="sm">
                <BlockStack gap="300">
                  <InlineStack gap="200" blockAlign="center">
                    <Icon source={ShieldCheckMarkIcon} tone="success" />
                    <Text as="h2" variant="headingMd">
                      About Safety Gate EU
                    </Text>
                  </InlineStack>
                  <Text as="p" variant="bodyMd">
                    Safety Gate is the European rapid alert system for dangerous non-food products. This app
                    monitors your Shopify catalog against that database so you can make safer merchandising
                    decisions.
                  </Text>
                </BlockStack>
              </Card>

              <Card padding="400" roundedAbove="sm">
                <BlockStack gap="300">
                  <InlineStack gap="200" blockAlign="center">
                    <Icon source={CheckCircleIcon} tone="success" />
                    <Text as="h2" variant="headingMd">
                      How it works
                    </Text>
                  </InlineStack>
                  <BlockStack gap="200">
                    {howItWorksItems.map((item) => (
                      <InlineStack key={item} gap="200" blockAlign="start">
                        <Icon source={CheckCircleIcon} tone="success" />
                        <Text as="p" variant="bodyMd">
                          {item}
                        </Text>
                      </InlineStack>
                    ))}
                  </BlockStack>
                </BlockStack>
              </Card>
            </InlineGrid>

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
