import { useEffect } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useFetcher, useLoaderData, useNavigation, useNavigate, useRouteError, isRouteErrorResponse } from "@remix-run/react";
import { json } from "@remix-run/node";
import { useTranslation } from "react-i18next";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import db, { type SafetySettingRecord } from "../merchant-db.server";
import { OnboardingWizard, formatRelativeDate } from "../components";
import { requireActiveBilling } from "../services/billing.server";
import {
  runMerchantDeltaMonitoring,
  shopifyProductToProductData,
  upsertMerchantProductForMonitoring,
} from "../services/safety-gate-checker.server";

type BulkCheckResults = {
  processed: number;
  checked: number;
  skipped: number;
  alertsCreated: number;
  errors: number;
  totalProducts: number;
  products: Array<{
    id: string;
    title: string;
    status: 'checked' | 'skipped' | 'error' | 'alert_created';
    message?: string;
  }>;
};

type ActionResponse = {
  success: boolean;
  message?: string;
  error?: string;
  results?: BulkCheckResults;
  progress?: {
    current: number;
    total: number;
    status: string;
  };
};

type ShopifyCatalogProduct = {
  id: string;
  title: string;
  handle?: string;
  updatedAt?: string;
  [key: string]: unknown;
};

async function fetchCurrentCatalogProducts(admin: any, limit = 300): Promise<ShopifyCatalogProduct[]> {
  const products: ShopifyCatalogProduct[] = [];
  let after: string | null = null;
  let hasNextPage = true;

  while (hasNextPage && products.length < limit) {
    const first = Math.min(100, limit - products.length);
    const response: { json: () => Promise<any> } = await admin.graphql(`#graphql
      query monitorCatalogProducts($first: Int!, $after: String) {
        products(first: $first, after: $after, sortKey: UPDATED_AT, reverse: true) {
          pageInfo {
            hasNextPage
            endCursor
          }
          edges {
            node {
              id
              title
              handle
              vendor
              productType
              tags
              description
              descriptionHtml
              featuredImage { url altText }
              images(first: 4) { nodes { url altText } }
              variants(first: 5) { edges { node { id title image { url altText } } } }
              updatedAt
              createdAt
            }
          }
        }
      }
    `, { variables: { first, after } });
    const payload: any = await response.json();
    if (payload.errors?.length) {
      throw new Error(payload.errors[0]?.message || "Could not load Shopify catalog");
    }

    const connection: any = payload.data?.products;
    const nodes = connection?.edges?.map((edge: any) => edge.node).filter(Boolean) || [];
    products.push(...nodes);
    hasNextPage = Boolean(connection?.pageInfo?.hasNextPage) && products.length < limit;
    after = connection?.pageInfo?.endCursor || null;
  }

  return products;
}

async function importCurrentCatalogForMonitoring(params: {
  admin: any;
  shop: string;
  limit?: number;
}): Promise<{ imported: number; failed: number; totalFetched: number }> {
  const products = await fetchCurrentCatalogProducts(params.admin, params.limit);
  let imported = 0;
  let failed = 0;

  for (const product of products) {
    try {
      const productId = product.id.replace("gid://shopify/Product/", "");
      const productData = shopifyProductToProductData(product);

      await upsertMerchantProductForMonitoring({
        shop: params.shop,
        productId,
        productTitle: product.title,
        productHandle: product.handle,
        product: productData,
        sourceUpdatedAt: product.updatedAt,
      });

      imported += 1;
    } catch (error) {
      failed += 1;
      console.error("Failed importing product for Safety Gate monitoring", {
        shop: params.shop,
        productId: product.id,
        error,
      });
    }
  }

  return { imported, failed, totalFetched: products.length };
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { billing, session, admin } = await authenticate.admin(request);
  const billingRedirect = await requireActiveBilling(billing, session.shop);
  if (billingRedirect) return billingRedirect as never;

  const [activeAlerts, totalAlerts, resolvedAlerts, dismissedAlerts, totalChecks, recentAlerts, checkedProductIds, activeAlertRiskSample, settings, recentActivities, lastMonitoringActivityRows] = await Promise.all([
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
      where: { shop: session.shop, status: 'active' },
      orderBy: { createdAt: 'desc' },
      take: 5,
    }),
    // Get list of already checked product IDs
    db.safetyCheck.findMany({
      where: { shop: session.shop },
      select: { productId: true },
      distinct: ['productId'],
    }),
    db.safetyAlert.findMany({
      where: { shop: session.shop, status: 'active' },
      select: { riskLevel: true, checkResult: true },
      take: 100,
    }),
    db.safetySetting.findUnique({
      where: { shop: session.shop },
    }),
    db.activityLog.findMany({
      where: { shop: session.shop },
      orderBy: { createdAt: 'desc' },
      take: 5,
    }),
    db.activityLog.findMany({
      where: { shop: session.shop },
      orderBy: { createdAt: 'desc' },
      take: 25,
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

  // Get total products count from Shopify
  let totalProductsCount = 0;
  try {
    const countResponse = await admin.graphql(`#graphql
      query { productsCount { count } }
    `);
    const countJson = await countResponse.json();
    totalProductsCount = countJson.data?.productsCount?.count || 0;
  } catch (e) {
    console.error("Error getting products count:", e);
  }

  const checkedProductCount = checkedProductIds.length;
  const uncheckedProductCount = Math.max(0, totalProductsCount - checkedProductCount);
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

  const defaultSettings: Partial<SafetySettingRecord> & { onboardingCompleted: boolean } = {
    onboardingCompleted: false,
    similarityThreshold: 70,
    autoDraftHighRisk: false,
    emailNotifications: false,
    slackWebhookUrl: null,
  };

  return json({
    stats: {
      activeAlerts,
      totalAlerts,
      resolvedAlerts,
      dismissedAlerts,
      totalChecks,
      totalProducts: totalProductsCount,
      checkedProducts: checkedProductCount,
      uncheckedProducts: uncheckedProductCount,
      criticalActiveAlerts,
    },
    recentAlerts: processedRecentAlerts,
    settings: (settings || defaultSettings) as SafetySettingRecord,
    recentActivities,
    lastMonitoringAt: lastMonitoringActivityRows.find((activity: any) =>
      activity.type === "bulk" || activity.type === "automatic" || activity.action === "check"
    )?.createdAt ?? null,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { billing, session, admin } = await authenticate.admin(request);
  const billingRedirect = await requireActiveBilling(billing, session.shop);
  if (billingRedirect) return billingRedirect as never;
  const formData = await request.formData();
  const actionType = formData.get("action");
  const includeAlreadyChecked = formData.get("includeAlreadyChecked") === "true";
  const monitoringModeValue = formData.get("monitoringMode");
  const monitoringMode = typeof monitoringModeValue === "string" && monitoringModeValue.trim()
    ? monitoringModeValue.trim()
    : "since-last-check";
  const monitoringDaysValue = formData.get("monitoringDays");
  const monitoringDays = typeof monitoringDaysValue === "string" && monitoringDaysValue.trim()
    ? Number(monitoringDaysValue)
    : undefined;

  if (actionType === "bulkCheck") {
    try {
      const monitoring = await runMerchantDeltaMonitoring(session.shop, {
        forceFullScan: includeAlreadyChecked,
        limit: 300,
        monitoringMode:
          monitoringMode === "weekly" ||
          monitoringMode === "last-days" ||
          monitoringMode === "full-lookback" ||
          monitoringMode === "since-last-check"
            ? monitoringMode
            : "since-last-check",
        days: Number.isFinite(monitoringDays) && monitoringDays && monitoringDays > 0
          ? monitoringDays
          : undefined,
      });

      const results: BulkCheckResults = {
        processed: monitoring.productsScanned,
        checked: monitoring.productsScanned,
        skipped: 0,
        alertsCreated: monitoring.alertsCreated,
        errors: 0,
        totalProducts: monitoring.productsScanned,
        products: [],
      };

      return json({
        success: true,
        message: `Monitoring scanned ${monitoring.productsScanned} products against ${monitoring.rapexAlertsScanned} new RAPEX alerts and created ${monitoring.alertsCreated} alerts`,
        results,
      });
    } catch (error) {
      console.error('Bulk check failed:', error);
      return json({ success: false, error: error instanceof Error ? error.message : 'Bulk check failed' }, { status: 500 });
    }
  }

  if (actionType === "importCatalogAndMonitor") {
    try {
      const importedCatalog = await importCurrentCatalogForMonitoring({
        admin,
        shop: session.shop,
        limit: 300,
      });
      const monitoring = await runMerchantDeltaMonitoring(session.shop, {
        forceFullScan: true,
        limit: 300,
        monitoringMode: "full-lookback",
      });

      await db.activityLog.create({
        data: {
          shop: session.shop,
          type: "bulk",
          action: "check",
          details: `Imported ${importedCatalog.imported} current catalog products for monitoring and checked them against recent Safety Gate alerts.`
        }
      });

      const results: BulkCheckResults = {
        processed: importedCatalog.imported,
        checked: monitoring.productsScanned,
        skipped: importedCatalog.failed,
        alertsCreated: monitoring.alertsCreated,
        errors: importedCatalog.failed,
        totalProducts: importedCatalog.totalFetched,
        products: [],
      };

      return json({
        success: true,
        message: `Imported ${importedCatalog.imported} products for monitoring and created ${monitoring.alertsCreated} Safety Gate review items`,
        results,
      });
    } catch (error) {
      console.error('Catalog import and monitoring failed:', error);
      return json({ success: false, error: error instanceof Error ? error.message : 'Catalog import and monitoring failed' }, { status: 500 });
    }
  }

  if (actionType === "completeOnboarding") {
    const similarityThreshold = Number(formData.get("similarityThreshold") || 70);
    const onboardingCompleted = formData.get("onboardingCompleted") === "true";
    const autoDraftHighRisk = formData.get("autoDraftHighRisk") === "true";
    const slackWebhookUrl = (formData.get("slackWebhookUrl") as string) || null;

    try {
      await db.safetySetting.upsert({
        where: { shop: session.shop },
        update: {
          similarityThreshold,
          onboardingCompleted,
          autoDraftHighRisk,
          emailNotifications: false,
          slackWebhookUrl,
        },
        create: {
          shop: session.shop,
          similarityThreshold,
          onboardingCompleted,
          autoDraftHighRisk,
          emailNotifications: false,
          slackWebhookUrl,
        },
      });

      return json({
        success: true,
        message: "Onboarding completed successfully!",
      });
    } catch (error) {
      console.error("Failed to complete onboarding:", error);
      return json({ success: false, error: "Failed to complete onboarding" }, { status: 500 });
    }
  }

  return json({ success: false, error: "Invalid action" }, { status: 400 });
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
      <s-heading slot="title" size="large" suppressHydrationWarning>{t("nav.dashboard")}</s-heading>
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

export default function Index() {
  const { stats, recentAlerts, settings, recentActivities, lastMonitoringAt } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<ActionResponse>();
  const navigation = useNavigation();
  const shopify = useAppBridge();
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();


  const isLoading = navigation.state === "loading";
  const isSubmitting = fetcher.state === "submitting";
  const monitoredProductLabel = `${stats.checkedProducts}/${stats.totalProducts || 0}`;
  const hasCompleteCoverage = stats.totalProducts > 0 && stats.checkedProducts >= stats.totalProducts;
  const cleanRiskLabel = (value?: string | null) =>
    value ? value.replace(/\s*\/\s*other\b/gi, "").trim() : "";

  const runBulkCheck = () => {
    if (isSubmitting) return;
    fetcher.submit(
      {
        action: "bulkCheck",
        includeAlreadyChecked: "false",
        monitoringMode: "since-last-check",
      },
      { method: "POST" },
    );
  };

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
      <s-page suppressHydrationWarning>
        <s-section>
          <s-skeleton-text lines="3" />
        </s-section>
      </s-page>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ONBOARDING WIZARD VIEW
  // ═══════════════════════════════════════════════════════════════════════════
  if (settings && !settings.onboardingCompleted) {
    const triggerInitialScan = () => {
      fetcher.submit(
        {
          action: "importCatalogAndMonitor",
        },
        { method: "POST" }
      );
    };

    const finishOnboarding = (payload: {
      similarityThreshold: number;
      autoDraftHighRisk: boolean;
      slackWebhookUrl: string;
    }) => {
      fetcher.submit(
        {
          action: "completeOnboarding",
          similarityThreshold: payload.similarityThreshold.toString(),
          onboardingCompleted: "true",
          autoDraftHighRisk: payload.autoDraftHighRisk.toString(),
          slackWebhookUrl: payload.slackWebhookUrl,
        },
        { method: "POST" }
      );
    };

    return (
      <OnboardingWizard
        stats={stats}
        isSubmitting={isSubmitting}
        onScanCatalog={triggerInitialScan}
        scanResults={fetcher.data || undefined}
        onComplete={finishOnboarding}
      />
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STANDARD DASHBOARD VIEW
  // ═══════════════════════════════════════════════════════════════════════════
  return (
    <s-page size="large" className="page-shell" suppressHydrationWarning>
      <s-heading slot="title" size="large" suppressHydrationWarning>{t('nav.dashboard')}</s-heading>
      <s-button
        slot="primary-action"
        variant="primary"
        loading={isSubmitting || undefined}
        onClick={() => {
          if (stats.activeAlerts > 0) {
            navigate("/app/alerts?status=active");
            return;
          }
          runBulkCheck();
        }}
        disabled={isSubmitting || undefined}
        suppressHydrationWarning
      >
        {isSubmitting
          ? t("actions.checking")
          : stats.activeAlerts > 0
            ? t("actions.reviewProductsNeedingAction", { count: stats.activeAlerts })
            : t("actions.checkNewSafetyGateAlerts")}
      </s-button>
      <s-button slot="secondary-actions" variant="secondary" href="/app/audit-report" suppressHydrationWarning>
        {t("actions.downloadAuditReport")}
      </s-button>
      <s-button slot="secondary-actions" variant="secondary" href="/app/evidence" suppressHydrationWarning>
        {t("actions.viewEvidence")}
      </s-button>

      <div className="admin-stack">
        <section className="monitoring-status-panel">
          <div className="monitoring-status-panel__header">
            <p className="admin-eyebrow">{t("dashboard.admin.monitoringStatusEyebrow")}</p>
            <h2 className="monitoring-status-panel__title">
              {stats.activeAlerts > 0
                ? t("dashboard.admin.monitoringStatusNeedsReview", { count: stats.activeAlerts })
                : t("dashboard.admin.monitoringStatusAllClear")}
            </h2>
            <p className="monitoring-status-panel__description">
              {t("dashboard.admin.monitoringStatusDescription")}
            </p>
          </div>
          <div className="monitoring-status-panel__facts">
            <div className="monitoring-status-panel__fact">
              <span>{t("dashboard.admin.productsMonitored")}</span>
              <strong>{monitoredProductLabel}</strong>
            </div>
            <div className="monitoring-status-panel__fact">
              <span>{t("dashboard.admin.lastSafetyGateUpdateChecked")}</span>
              <strong>{lastMonitoringAt ? formatRelativeDate(new Date(lastMonitoringAt), t, i18n.language) : t("status.notChecked")}</strong>
            </div>
            <div className="monitoring-status-panel__fact">
              <span>{t("dashboard.admin.nextAutomaticCheck")}</span>
              <strong>{t("dashboard.admin.dailyAtTime")}</strong>
            </div>
            <div className="monitoring-status-panel__fact">
              <span>{t("dashboard.admin.auditReport")}</span>
              <strong>{t("dashboard.admin.auditReady")}</strong>
            </div>
          </div>
        </section>

        <section className="subscription-value-panel">
          <div className="subscription-value-panel__header">
            <p className="admin-eyebrow">{t("dashboard.admin.valueProofEyebrow")}</p>
            <h2 className="admin-card__title">
              {hasCompleteCoverage
                ? t("dashboard.admin.valueProofTitleComplete")
                : t("dashboard.admin.valueProofTitleIncomplete", { count: stats.uncheckedProducts })}
            </h2>
            <p className="admin-card__description">
              {hasCompleteCoverage
                ? t("dashboard.admin.valueProofDescriptionComplete")
                : t("dashboard.admin.valueProofDescriptionIncomplete")}
            </p>
            {!hasCompleteCoverage && (
              <div className="subscription-value-panel__action">
                <s-button variant="primary" href="/app/manual-check">
                  {t("dashboard.admin.finishCoverage")}
                </s-button>
              </div>
            )}
          </div>
          <div className="subscription-value-grid">
            <div className={`subscription-value-item${hasCompleteCoverage ? " subscription-value-item--trust" : " subscription-value-item--attention"}`}>
              <span>{t("dashboard.admin.valueMetrics.productsCovered")}</span>
              <strong>{monitoredProductLabel}</strong>
            </div>
            <div className="subscription-value-item">
              <span>{t("dashboard.admin.valueMetrics.openDecisions")}</span>
              <strong>{stats.activeAlerts}</strong>
            </div>
            <div className="subscription-value-item">
              <span>{t("dashboard.admin.valueMetrics.evidenceRetained")}</span>
              <strong>{stats.resolvedAlerts + stats.dismissedAlerts}</strong>
            </div>
          </div>
        </section>

        {stats.activeAlerts > 0 && (
          <s-banner
            tone={stats.criticalActiveAlerts > 0 ? "critical" : "warning"}
            heading={stats.criticalActiveAlerts > 0
              ? t("dashboard.admin.criticalBannerTitle", { count: stats.activeAlerts })
              : t("dashboard.admin.warningBannerTitle", { count: stats.activeAlerts })}
          >
            <s-text>
              {stats.criticalActiveAlerts > 0
                ? t("dashboard.admin.criticalBannerDescription", { count: stats.criticalActiveAlerts })
                : t("dashboard.admin.warningBannerDescription")}
            </s-text>
            <div style={{ marginTop: "var(--s-space-200)" }}>
              <s-button variant="primary" onClick={() => navigate("/app/alerts?status=active")}>
                {t("actions.reviewAlerts")}
              </s-button>
            </div>
          </s-banner>
        )}

        <div className="admin-section-grid">
          {/* Left Column: Merchant decision queue */}
          <section className="admin-card">
            <div className="admin-card__header">
              <div>
                <p className="admin-eyebrow">{t("dashboard.admin.priorityQueue")}</p>
                <h2 className="admin-card__title">{t("dashboard.admin.recentAlertsTitle")}</h2>
                <p className="admin-card__description">
                  {t("dashboard.admin.recentAlertsDescription")}
                </p>
              </div>
              <div className="admin-actions">
                <s-button variant="secondary" onClick={() => navigate("/app/manual-check")}>
                  {t("actions.checkOneProduct")}
                </s-button>
                <s-button variant="secondary" onClick={() => navigate("/app/alerts")}>
                  {t("actions.viewAlerts")}
                </s-button>
              </div>
            </div>

            {recentAlerts.length === 0 ? (
              <div className="dashboard-demo-state">
                <div className="admin-empty-state">
                  <h3>{t("dashboard.admin.noAlertsTitle")}</h3>
                  <p>{t("dashboard.admin.noAlertsDescription")}</p>
                </div>
                <div className="demo-alert-preview">
                  <div className="demo-alert-preview__header">
                    <s-badge tone="critical">{t("dashboard.admin.demoAlert.badge")}</s-badge>
                    <span>{t("dashboard.admin.demoAlert.sample")}</span>
                  </div>
                  <h3>{t("dashboard.admin.demoAlert.title")}</h3>
                  <p>{t("dashboard.admin.demoAlert.description")}</p>
                  <div className="demo-alert-preview__facts">
                    <span>{t("dashboard.admin.demoAlert.reason")}</span>
                    <span>{t("dashboard.admin.demoAlert.action")}</span>
                    <span>{t("dashboard.admin.demoAlert.evidence")}</span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="admin-alert-list">
                {recentAlerts.map((alert) => (
                  <div className="admin-alert-row" key={alert.id}>
                    <div className="admin-alert-row__media">
                      {alert.productImage ? (
                        <img src={alert.productImage} alt={alert.productTitle} className="admin-alert-row__image" />
                      ) : (
                        <div className="admin-alert-row__placeholder">!</div>
                      )}
                    </div>
                    <div className="admin-alert-row__content">
                      <div className="admin-alert-row__meta">
                        <h3>{alert.productTitle}</h3>
                        <p>{alert.riskDescription || t("dashboard.admin.fallbackAlertDescription")}</p>
                        <p className="admin-alert-row__next-action">
                          {t("dashboard.admin.recommendedAction")}
                        </p>
                      </div>
                      <div className="admin-inline-meta">
                        <s-badge tone={alert.status === "active" ? "critical" : alert.status === "resolved" ? "success" : "info"}>
                          {alert.status === "active"
                            ? t("status.needsReview")
                            : alert.status === "resolved"
                              ? t("status.resolved")
                              : t("status.dismissed")}
                        </s-badge>
                        {alert.alertType && <s-badge tone="warning">{cleanRiskLabel(alert.alertType)}</s-badge>}
                      </div>
                    </div>
                    <div className="admin-alert-row__actions">
                      <s-button variant="secondary" onClick={() => navigate("/app/alerts")}>
                        {t("actions.reviewDecision")}
                      </s-button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Right Column: Audit trail */}
          <section className="admin-card">
            <div className="admin-card__header">
              <div>
                <p className="admin-eyebrow">{t("uxEnhancements.activityTimeline.eyebrow")}</p>
                <h2 className="admin-card__title">{t("uxEnhancements.activityTimeline.title")}</h2>
                <p className="admin-card__description">
                  {t("uxEnhancements.activityTimeline.description")}
                </p>
              </div>
            </div>

            {recentActivities.length === 0 ? (
              <div className="admin-empty-state">
                <h3>{t("uxEnhancements.activityTimeline.noActivity")}</h3>
              </div>
            ) : (
              <div className="activity-timeline">
                {recentActivities.map((activity: any) => {
                  const actionClass = activity.action === "quarantine"
                    ? "activity-timeline__dot--quarantine"
                    : activity.action === "resolve"
                    ? "activity-timeline__dot--resolve"
                    : activity.action === "dismiss"
                    ? "activity-timeline__dot--dismiss"
                    : "activity-timeline__dot--check";

                  const actionTitle = t(`uxEnhancements.activityTimeline.actions.${activity.action}`, {
                    defaultValue: activity.action
                  });

                  let detailsText = activity.details;
                  if (detailsText === "Product checked and verified as safe." || detailsText === "Product checked and verified as safe") {
                    detailsText = t("uxEnhancements.activityTimeline.details.checkSafe");
                  } else if (detailsText === "Safety risk detected! Alert created." || detailsText === "Safety risk detected! Alert created") {
                    detailsText = t("uxEnhancements.activityTimeline.details.checkUnsafe");
                  } else if (detailsText.startsWith("Bulk catalog scan completed") || detailsText.startsWith("Bulk scan")) {
                    detailsText = t("uxEnhancements.activityTimeline.details.bulkScanned");
                  } else if (
                    detailsText === "Product status changed to draft in Shopify." ||
                    detailsText === "Product status changed to draft" ||
                    detailsText.startsWith("Marked high-risk product for priority review.")
                  ) {
                    detailsText = t("uxEnhancements.activityTimeline.details.autoDrafted");
                  } else if (detailsText.startsWith("Reason: ")) {
                    const reasonStr = detailsText.substring("Reason: ".length);
                    detailsText = t("uxEnhancements.activityTimeline.details.reason", { reason: reasonStr });
                  } else if (detailsText === "No reason specified.") {
                    detailsText = t("uxEnhancements.activityTimeline.details.noReason");
                  }

                  const typeLabel = t(`uxEnhancements.activityTimeline.types.${activity.type}`, {
                    defaultValue: activity.type
                  });

                  return (
                    <div key={activity.id} className="activity-timeline__item">
                      <div className={`activity-timeline__dot ${actionClass}`} />
                      <div className="activity-timeline__content">
                        <h4 className="activity-timeline__title">{actionTitle}</h4>
                        <div className="activity-timeline__time">
                          {formatRelativeDate(new Date(activity.createdAt), t, i18n.language)} • <span style={{ textTransform: "capitalize" }}>{typeLabel}</span>
                        </div>
                        {detailsText && (
                          <p className="activity-timeline__details">{detailsText}</p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      </div>
    </s-page>
  );
}
