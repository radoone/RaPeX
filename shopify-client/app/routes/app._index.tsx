import { useEffect, useState, useRef } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useFetcher, useLoaderData, useNavigation, useNavigate, data } from "@remix-run/react";
import { useTranslation } from "react-i18next";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { LanguageSwitcher } from "../components";

type BulkCheckResults = {
  processed: number;
  checked: number;
  alertsCreated: number;
  errors: number;
  startTime: Date;
  endTime: Date | null;
};

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
  const { session, admin } = await authenticate.admin(request);

  const [activeAlerts, totalAlerts, resolvedAlerts, dismissedAlerts, totalChecks, recentAlerts] = await Promise.all([
    db.safetyAlert.count({
      where: { shop: session.shop, status: 'active' },
    }),
    db.safetyAlert.count({
      where: { shop: session.shop },
    }),
    db.safetyAlert.count({
      where: { shop: session.shop, status: 'resolved' },
    }),
    db.safetyAlert.count({
      where: { shop: session.shop, status: 'dismissed' },
    }),
    db.safetyCheck.count({
      where: { shop: session.shop },
    }),
    db.safetyAlert.findMany({
      where: { shop: session.shop },
      orderBy: { createdAt: 'desc' },
      take: 5,
    }),
  ]);

  // Fetch product images from Shopify
  const productIds = recentAlerts.map((a: any) => a.productId).filter(Boolean).map((id: string) =>
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

  const processedRecentAlerts = recentAlerts.map((alert: any) => {
    let alertType = undefined;
    let riskDescription = undefined;
    let fallbackImage = null;

    try {
      if (alert.checkResult) {
        const checkResult = JSON.parse(alert.checkResult);
        if (checkResult.warnings && checkResult.warnings.length > 0) {
          const firstWarning = checkResult.warnings[0];
          alertType = firstWarning.alertType || firstWarning.alertDetails?.fields?.alert_type;
          riskDescription = firstWarning.riskLegalProvision || firstWarning.alertDetails?.fields?.risk_legal_provision;

          const fields = firstWarning.alertDetails?.fields || {};
          const pics = [...(fields.pictures || []), fields.product_image].filter(Boolean);
          if (pics[0]) fallbackImage = typeof pics[0] === 'string' ? pics[0] : pics[0].url;
        }
      }
    } catch (error) {
      console.error('Error parsing checkResult for alert', alert.id, error);
    }

    const productImage = productImages[alert.productId] ||
                        productImages[`gid://shopify/Product/${alert.productId}`] ||
                        fallbackImage || null;

    return { ...alert, alertType, riskDescription, productImage };
  });

  return {
    stats: { activeAlerts, totalAlerts, resolvedAlerts, dismissedAlerts, totalChecks },
    recentAlerts: processedRecentAlerts,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const action = formData.get("action");

  if (action === "bulkCheck") {
    try {
      const { admin } = await authenticate.admin(request);
      const { bulkCheckProducts } = await import("../services/safety-gate-checker.server");
      const results = await bulkCheckProducts(admin, session.shop, db);
      return {
        success: true,
        message: `Bulk check completed: ${results.processed} products processed, ${results.alertsCreated} alerts created`,
        results
      };
    } catch (error) {
      console.error('Bulk check failed:', error);
      return data({ success: false, error: error instanceof Error ? error.message : 'Bulk check failed' }, { status: 500 });
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
  const navigate = useNavigate();

  // Visibility state for dismissible sections
  const [visible, setVisible] = useState({
    banner: stats.activeAlerts > 0,
    setupGuide: stats.totalChecks === 0,
    calloutCard: true,
    news: true,
  });

  // Expanded state for setup guide
  const [expanded, setExpanded] = useState({
    setupGuide: true,
    step1: false,
    step2: false,
    step3: false,
  });

  // Progress tracking
  const [progress, setProgress] = useState(0);

  // Button refs for native event listeners
  const bulkCheckBtnRef = useRef<HTMLElement>(null);
  const bulkCheckBtn2Ref = useRef<HTMLElement>(null);
  const bulkCheckBtn3Ref = useRef<HTMLElement>(null);
  const manualCheckBtnRef = useRef<HTMLElement>(null);
  const settingsBtnRef = useRef<HTMLElement>(null);

  const isLoading = navigation.state === "loading";
  const isSubmitting = fetcher.state === "submitting";

  const resolvedAlerts = stats.resolvedAlerts;
  const resolutionRate = stats.totalAlerts > 0 ? Math.round((resolvedAlerts / stats.totalAlerts) * 100) : 100;

  const runBulkCheck = () => {
    if (isSubmitting) return;
    fetcher.submit({ action: 'bulkCheck' }, { method: 'POST' });
  };

  const hasBulkCheckResults = (data: any): data is { success: boolean; results: SerializedBulkCheckResults } => {
    return data?.success === true && data.results !== undefined;
  };

  const bulkResults = hasBulkCheckResults(fetcher.data) ? fetcher.data.results : null;

  // Native event listeners for buttons
  useEffect(() => {
    const bulkBtn = bulkCheckBtnRef.current;
    if (bulkBtn) {
      const handleClick = () => runBulkCheck();
      bulkBtn.addEventListener('click', handleClick);
      return () => bulkBtn.removeEventListener('click', handleClick);
    }
  }, [isSubmitting]);

  useEffect(() => {
    const bulkBtn = bulkCheckBtn2Ref.current;
    if (bulkBtn) {
      const handleClick = () => runBulkCheck();
      bulkBtn.addEventListener('click', handleClick);
      return () => bulkBtn.removeEventListener('click', handleClick);
    }
  }, [isSubmitting]);

  useEffect(() => {
    const bulkBtn = bulkCheckBtn3Ref.current;
    if (bulkBtn) {
      const handleClick = () => runBulkCheck();
      bulkBtn.addEventListener('click', handleClick);
      return () => bulkBtn.removeEventListener('click', handleClick);
    }
  }, [isSubmitting]);

  useEffect(() => {
    const manualBtn = manualCheckBtnRef.current;
    if (manualBtn) {
      const handleClick = () => navigate('/app/manual-check');
      manualBtn.addEventListener('click', handleClick);
      return () => manualBtn.removeEventListener('click', handleClick);
    }
  }, [navigate]);

  useEffect(() => {
    const settingsBtn = settingsBtnRef.current;
    if (settingsBtn) {
      const handleClick = () => navigate('/app/settings');
      settingsBtn.addEventListener('click', handleClick);
      return () => settingsBtn.removeEventListener('click', handleClick);
    }
  }, [navigate]);

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
      <s-page>
        <s-section>
          <s-skeleton-text lines="3" />
        </s-section>
      </s-page>
    );
  }

  return (
    <s-page>
      {/* Primary Actions - Using slots */}
      <s-button ref={bulkCheckBtnRef} slot="primary-action" variant="primary" loading={isSubmitting || undefined}>
        {t('actions.checkAll')}
      </s-button>
      <s-button ref={manualCheckBtnRef} slot="secondary-actions">
        {t('actions.manualCheck')}
      </s-button>
      <s-button ref={settingsBtnRef} slot="secondary-actions">
        {t('actions.settings')}
      </s-button>

      {/* === Banner === */}
      {/* Use banners sparingly. Only one banner should be visible at a time. */}
      {visible.banner && stats.activeAlerts > 0 && (
        <s-banner
          tone="critical"
          dismissible
          onDismiss={() => setVisible({ ...visible, banner: false })}
        >
          {t('dashboard.activeAlertsBanner.content', { count: stats.activeAlerts })}{' '}
          <s-link onClick={() => navigate('/app/alerts')}>{t('dashboard.activeAlertsBanner.reviewAction')}</s-link>
          {' • '}
          <s-link onClick={() => navigate('/app/manual-check')}>{t('dashboard.activeAlertsBanner.manualCheckAction')}</s-link>
        </s-banner>
      )}

      {/* Bulk Check Results Banner */}
      {bulkResults && (
        <s-banner tone="success" dismissible>
          {t('dashboard.bulkResults.success', {
            processed: bulkResults.processed,
            checked: bulkResults.checked,
            alertsCreated: bulkResults.alertsCreated
          })}
        </s-banner>
      )}

      {/* === Setup Guide === */}
      {/* Keep instructions brief and direct. Only ask merchants for required information. */}
      {visible.setupGuide && stats.totalChecks === 0 && (
        <s-section>
          <s-grid gap="small">
            {/* Header */}
            <s-grid gap="small-200">
              <s-grid
                gridTemplateColumns="1fr auto auto"
                gap="small-300"
                alignItems="center"
              >
                <s-heading>{t('dashboard.setup.title')}</s-heading>
                <s-button
                  accessibilityLabel={t('dashboard.setup.title')}
                  onClick={() => setVisible({ ...visible, setupGuide: false })}
                  variant="tertiary"
                  tone="neutral"
                  icon="x"
                />
                <s-button
                  accessibilityLabel={t('dashboard.setup.title')}
                  onClick={() => setExpanded({ ...expanded, setupGuide: !expanded.setupGuide })}
                  variant="tertiary"
                  tone="neutral"
                  icon={expanded.setupGuide ? "chevron-up" : "chevron-down"}
                />
              </s-grid>
              <s-paragraph>
                {t('dashboard.setup.description')}
              </s-paragraph>
              <s-paragraph color="subdued">
                {t('dashboard.setup.progress', { completed: progress, total: 3 })}
              </s-paragraph>
            </s-grid>

            {/* Steps Container */}
            <s-box
              borderRadius="base"
              border="base"
              background="base"
              display={expanded.setupGuide ? "auto" : "none"}
            >
              {/* Step 1 */}
              <s-box>
                <s-grid gridTemplateColumns="1fr auto" gap="base" padding="small">
                  <s-checkbox
                    label={t('dashboard.setup.steps.step1.label')}
                    onInput={(e: any) => setProgress(e.currentTarget?.checked ? progress + 1 : progress - 1)}
                  />
                  <s-button
                    onClick={() => setExpanded({ ...expanded, step1: !expanded.step1 })}
                    accessibilityLabel={t('dashboard.setup.steps.step1.label')}
                    variant="tertiary"
                    icon={expanded.step1 ? "chevron-up" : "chevron-down"}
                  />
                </s-grid>
                <s-box padding="small" paddingBlockStart="none" display={expanded.step1 ? "auto" : "none"}>
                  <s-box padding="base" background="subdued" borderRadius="base">
                    <s-stack gap="small">
                      <s-paragraph>
                        {t('dashboard.setup.steps.step1.description')}
                      </s-paragraph>
                      <s-button ref={bulkCheckBtn2Ref} loading={isSubmitting || undefined}>
                        {t('actions.checkAll')}
                      </s-button>
                    </s-stack>
                  </s-box>
                </s-box>
              </s-box>
              <s-divider />

              {/* Step 2 */}
              <s-box>
                <s-grid gridTemplateColumns="1fr auto" gap="base" padding="small">
                  <s-checkbox
                    label={t('dashboard.setup.steps.step2.label')}
                    onInput={(e: any) => setProgress(e.currentTarget?.checked ? progress + 1 : progress - 1)}
                  />
                  <s-button
                    onClick={() => setExpanded({ ...expanded, step2: !expanded.step2 })}
                    accessibilityLabel={t('dashboard.setup.steps.step2.label')}
                    variant="tertiary"
                    icon={expanded.step2 ? "chevron-up" : "chevron-down"}
                  />
                </s-grid>
                <s-box padding="small" paddingBlockStart="none" display={expanded.step2 ? "auto" : "none"}>
                  <s-box padding="base" background="subdued" borderRadius="base">
                    <s-paragraph>
                      {t('dashboard.setup.steps.step2.description')}
                    </s-paragraph>
                  </s-box>
                </s-box>
              </s-box>
              <s-divider />

              {/* Step 3 */}
              <s-box>
                <s-grid gridTemplateColumns="1fr auto" gap="base" padding="small">
                  <s-checkbox
                    label={t('dashboard.setup.steps.step3.label')}
                    onInput={(e: any) => setProgress(e.currentTarget?.checked ? progress + 1 : progress - 1)}
                  />
                  <s-button
                    onClick={() => setExpanded({ ...expanded, step3: !expanded.step3 })}
                    accessibilityLabel={t('dashboard.setup.steps.step3.label')}
                    variant="tertiary"
                    icon={expanded.step3 ? "chevron-up" : "chevron-down"}
                  />
                </s-grid>
                <s-box padding="small" paddingBlockStart="none" display={expanded.step3 ? "auto" : "none"}>
                  <s-box padding="base" background="subdued" borderRadius="base">
                    <s-paragraph>
                      {t('dashboard.setup.steps.step3.description')}
                    </s-paragraph>
                  </s-box>
                </s-box>
              </s-box>
            </s-box>
          </s-grid>
        </s-section>
      )}

      {/* === Metrics Card === */}
      <s-section padding="base">
        <s-grid
          gridTemplateColumns="@container (inline-size <= 400px) 1fr, 1fr auto 1fr auto 1fr"
          gap="small"
        >
          <s-clickable
            onClick={() => navigate('/app/alerts?status=active')}
            paddingBlock="small-400"
            paddingInline="small-100"
            borderRadius="base"
          >
            <s-grid gap="small-300">
              <s-heading>{t('dashboard.metricsCard.activeAlertsHeading')}</s-heading>
              <s-stack direction="inline" gap="small-200">
                <s-text size="large">{stats.activeAlerts}</s-text>
                <s-badge tone={stats.activeAlerts > 0 ? "critical" : "success"} icon={stats.activeAlerts > 0 ? "alert" : "checkmark"}>
                  {stats.activeAlerts > 0 ? t('status.needsReview') : t('status.allClear')}
                </s-badge>
              </s-stack>
              <s-text tone="subdued">{t('dashboard.metricsCard.totalRecorded', { count: stats.totalAlerts })}</s-text>
            </s-grid>
          </s-clickable>

          <s-divider direction="block" />

          <s-clickable
            onClick={() => navigate('/app/alerts?status=resolved')}
            paddingBlock="small-400"
            paddingInline="small-100"
            borderRadius="base"
          >
            <s-grid gap="small-300">
              <s-heading>{t('dashboard.metricsCard.resolutionHeading')}</s-heading>
              <s-stack direction="inline" gap="small-200">
                <s-text size="large">{resolutionRate}%</s-text>
                <s-badge tone={resolutionRate >= 50 ? "success" : "warning"} icon={resolutionRate >= 50 ? "arrow-up" : "arrow-down"}>
                  {t('dashboard.metricsCard.resolved', { count: resolvedAlerts })}
                </s-badge>
              </s-stack>
              <s-text tone="subdued">
                {t('dashboard.metricsCard.resolvedAndDismissed', { resolved: resolvedAlerts, dismissed: stats.dismissedAlerts })}
              </s-text>
            </s-grid>
          </s-clickable>

          <s-divider direction="block" />

          <s-clickable
            onClick={() => navigate('/app/alerts')}
            paddingBlock="small-400"
            paddingInline="small-100"
            borderRadius="base"
          >
            <s-grid gap="small-300">
              <s-heading>{t('dashboard.metricsCard.productsCheckedHeading')}</s-heading>
              <s-stack direction="inline" gap="small-200">
                <s-text size="large">{stats.totalChecks}</s-text>
                <s-badge tone={stats.totalChecks > 0 ? "success" : "warning"}>
                  {stats.totalChecks > 0 ? t('status.monitored') : t('status.runCheck')}
                </s-badge>
              </s-stack>
              <s-text tone="subdued">{t('dashboard.metricsCard.scans')}</s-text>
            </s-grid>
          </s-clickable>
        </s-grid>
      </s-section>

      {/* === Recent Alerts === */}
      <s-section>
        <s-grid gridTemplateColumns="1fr auto" alignItems="center" paddingBlockEnd="small-400">
          <s-heading>{t('dashboard.recentAlerts.title')}</s-heading>
          <s-button onClick={() => navigate('/app/alerts')}>{t('actions.viewAlerts')}</s-button>
        </s-grid>

        {recentAlerts.length === 0 ? (
          <s-box padding="large" background="subdued" borderRadius="base">
            <s-stack gap="small" alignItems="center">
              <s-text>{t('dashboard.recentAlerts.emptyState.heading')}</s-text>
              <s-paragraph tone="subdued">
                {t('dashboard.recentAlerts.emptyState.content')}
              </s-paragraph>
              <s-button ref={bulkCheckBtn3Ref} loading={isSubmitting || undefined}>
                {t('actions.checkAll')}
              </s-button>
            </s-stack>
          </s-box>
        ) : (
          <s-grid gridTemplateColumns="repeat(auto-fit, minmax(280px, 1fr))" gap="base">
            {recentAlerts.map((alert) => (
              <s-clickable
                key={alert.id}
                onClick={() => navigate('/app/alerts')}
                border="base"
                borderRadius="base"
                padding="base"
                inlineSize="100%"
              >
                <s-grid gridTemplateColumns="auto 1fr" alignItems="start" gap="base">
                  {alert.productImage ? (
                    <s-thumbnail
                      size="small"
                      src={alert.productImage}
                      alt={alert.productTitle}
                    />
                  ) : (
                    <s-box background="subdued" borderRadius="base" padding="small-400">
                      <s-icon name="product" />
                    </s-box>
                  )}
                  <s-box>
                    <s-heading size="small">{alert.productTitle}</s-heading>
                    <s-stack direction="inline" gap="small-200" wrap>
                      <s-badge tone={alert.status === 'active' ? 'critical' : alert.status === 'resolved' ? 'success' : 'info'}>
                        {alert.status === 'active'
                          ? t('status.needsReview')
                          : alert.status === 'resolved'
                            ? t('status.resolved')
                            : t('status.dismissed')}
                      </s-badge>
                      {alert.alertType && (
                        <s-badge tone="warning">{alert.alertType}</s-badge>
                      )}
                    </s-stack>
                    <s-paragraph tone="subdued">
                      {t('dashboard.recentAlerts.matchCount', { count: alert.warningsCount })}
                    </s-paragraph>
                  </s-box>
                </s-grid>
              </s-clickable>
            ))}
          </s-grid>
        )}

        <s-stack
          direction="inline"
          alignItems="center"
          justifyContent="center"
          paddingBlockStart="base"
        >
          <s-link onClick={() => navigate('/app/alerts')}>{t('actions.viewAlerts')}</s-link>
        </s-stack>
      </s-section>

      {/* === News === */}
      {visible.news && (
        <s-section>
          <s-grid gridTemplateColumns="1fr auto" alignItems="center" paddingBlockEnd="small-400">
            <s-heading>{t('news.title')}</s-heading>
            <s-button
              onClick={() => setVisible({ ...visible, news: false })}
              icon="x"
              tone="neutral"
              variant="tertiary"
              accessibilityLabel="Dismiss news section"
            />
          </s-grid>
          <s-grid gridTemplateColumns="repeat(auto-fit, minmax(240px, 1fr))" gap="base">
            {/* News item 1 */}
            <s-grid
              background="base"
              border="base"
              borderRadius="base"
              padding="base"
              gap="small-400"
            >
              <s-text tone="subdued">{t('news.items.databaseUpdate.date')}</s-text>
              <s-link href="https://ec.europa.eu/safety-gate-alerts/screen/home" target="_blank">
                <s-heading size="small">{t('news.items.databaseUpdate.title')}</s-heading>
              </s-link>
              <s-paragraph>
                {t('news.items.databaseUpdate.description')}
              </s-paragraph>
            </s-grid>

            {/* News item 2 */}
            <s-grid
              background="base"
              border="base"
              borderRadius="base"
              padding="base"
              gap="small-400"
            >
              <s-text tone="subdued">{t('news.items.gpsr.date')}</s-text>
              <s-link href="https://ec.europa.eu/safety-gate-alerts/screen/pages/gpsr" target="_blank">
                <s-heading size="small">{t('news.items.gpsr.title')}</s-heading>
              </s-link>
              <s-paragraph>
                {t('news.items.gpsr.description')}
              </s-paragraph>
            </s-grid>
          </s-grid>
        </s-section>
      )}

      {/* === Safety Gate Portal (Callout Card) === */}
      {visible.calloutCard && (
        <s-section>
          <s-grid gridTemplateColumns="1fr auto" alignItems="center" paddingBlockEnd="small-400">
            <s-heading>{t('portal.title')}</s-heading>
            <s-button
              onClick={() => setVisible({ ...visible, calloutCard: false })}
              icon="x"
              tone="neutral"
              variant="tertiary"
              accessibilityLabel="Dismiss section"
            />
          </s-grid>
          <s-grid gridTemplateColumns="repeat(auto-fit, minmax(240px, 1fr))" gap="base">
            {/* Search Database */}
            <s-clickable
              href="https://ec.europa.eu/safety-gate-alerts/screen/search?resetSearch=true"
              target="_blank"
              border="base"
              borderRadius="base"
              padding="base"
              inlineSize="100%"
            >
              <s-grid gridTemplateColumns="auto 1fr auto" alignItems="stretch" gap="base">
                <s-box background="subdued" borderRadius="base" padding="small-400">
                  <s-icon name="search" />
                </s-box>
                <s-box>
                  <s-heading size="small">{t('portal.searchDatabase')}</s-heading>
                  <s-paragraph>{t('portal.searchDescription')}</s-paragraph>
                </s-box>
                <s-stack justifyContent="start">
                  <s-icon name="external" />
                </s-stack>
              </s-grid>
            </s-clickable>

            {/* Safety Gate Home */}
            <s-clickable
              href="https://ec.europa.eu/safety-gate-alerts/screen/home"
              target="_blank"
              border="base"
              borderRadius="base"
              padding="base"
              inlineSize="100%"
            >
              <s-grid gridTemplateColumns="auto 1fr auto" alignItems="stretch" gap="base">
                <s-box background="subdued" borderRadius="base" padding="small-400">
                  <s-icon name="home" />
                </s-box>
                <s-box>
                  <s-heading size="small">{t('portal.home')}</s-heading>
                  <s-paragraph>{t('portal.homeDescription')}</s-paragraph>
                </s-box>
                <s-stack justifyContent="start">
                  <s-icon name="external" />
                </s-stack>
              </s-grid>
            </s-clickable>
          </s-grid>
        </s-section>
      )}

      {/* === Language Switcher === */}
      <s-section>
        <s-grid gridTemplateColumns="1fr auto" alignItems="center">
          <s-text tone="subdued">{t('common.language')}</s-text>
          <LanguageSwitcher />
        </s-grid>
      </s-section>
    </s-page>
  );
}
