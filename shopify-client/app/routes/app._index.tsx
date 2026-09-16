import { useEffect, useRef } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData, useNavigation, useNavigate, useRouteError, isRouteErrorResponse } from "react-router";
import { data as json } from "react-router";
import { useTranslation } from "react-i18next";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import db, { type SafetySettingRecord } from "../merchant-db.server";
import { firestore } from "../firestore.server";
import { formatRelativeDate } from "../components";
import { getBillingStatus, requireActiveBilling } from "../services/billing.server";
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

async function fetchCurrentCatalogProductIds(admin: any, limit = 300): Promise<string[]> {
  const productIds: string[] = [];
  let after: string | null = null;
  let hasNextPage = true;

  while (hasNextPage && productIds.length < limit) {
    const first = Math.min(100, limit - productIds.length);
    const response: { json: () => Promise<any> } = await admin.graphql(`#graphql
      query dashboardCatalogProductIds($first: Int!, $after: String) {
        products(first: $first, after: $after) {
          pageInfo { hasNextPage endCursor }
          nodes { id }
        }
      }
    `, { variables: { first, after } });
    const payload = await response.json();
    const connection = payload.data?.products;
    productIds.push(...(connection?.nodes || []).map((product: { id: string }) =>
      product.id.replace("gid://shopify/Product/", ""),
    ));
    hasNextPage = Boolean(connection?.pageInfo?.hasNextPage) && productIds.length < limit;
    after = connection?.pageInfo?.endCursor || null;
  }

  return productIds;
}

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
  const billingRedirect = await requireActiveBilling(billing, session.shop, {
    allowFreeInitialScan: true,
  });
  if (billingRedirect) return billingRedirect as never;

  const billingStatus = await getBillingStatus(billing, session.shop);

  const [activeAlerts, totalAlerts, resolvedAlerts, dismissedAlerts, totalChecks, recentAlerts, checkedProductIds, activeAlertRiskSample, storedSettings, recentActivities, lastMonitoringActivityRows, currentCatalogProductIds] = await Promise.all([
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
    fetchCurrentCatalogProductIds(admin),
  ]);

  let settings = storedSettings;
  if (!settings || settings.emailNotifications === undefined || !settings.notificationEmail) {
    let shopifyEmail: string | null = null;
    try {
      const response = await admin.graphql(`#graphql
        query dashboardNotificationContactEmail { shop { contactEmail email } }
      `);
      const payload = await response.json();
      const candidate = String(payload.data?.shop?.contactEmail || payload.data?.shop?.email || "").trim().toLowerCase();
      shopifyEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate) ? candidate : null;
    } catch (error) {
      console.warn("Could not initialize notification email from Shopify", error);
    }
    settings = await db.safetySetting.upsert({
      where: { shop: session.shop },
      update: {
        ...(settings?.emailNotifications === undefined ? { emailNotifications: true } : {}),
        ...(!settings?.notificationEmail && shopifyEmail ? { notificationEmail: shopifyEmail, notificationEmailSource: "shopify" as const } : {}),
        ...(!settings?.notificationLanguage ? { notificationLanguage: "en" } : {}),
      },
      create: {
        shop: session.shop,
        onboardingCompleted: false,
        similarityThreshold: 70,
        autoDraftHighRisk: false,
        emailNotifications: true,
        notificationEmail: shopifyEmail,
        notificationEmailSource: "shopify",
        notificationLanguage: "en",
      },
    });
  }

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

  const checkedProductIdSet = new Set(checkedProductIds.map((check: any) => check.productId).filter(Boolean));
  const coveredProductIds = new Set(checkedProductIdSet);
  const currentCatalogProductIdSet = new Set(currentCatalogProductIds);
  const monitoredProducts = currentCatalogProductIds.length > 0
    ? await firestore.collection("merchants").doc(encodeURIComponent(session.shop)).collection("products").get()
    : null;
  monitoredProducts?.forEach((snapshot: any) => {
    const product = snapshot.data();
    if (
      currentCatalogProductIdSet.has(product?.productId) &&
      (product?.vector_text || product?.vector_image || product?.sourceUpdatedAt)
    ) {
      coveredProductIds.add(product.productId);
    }
  });
  const checkedProductCount = currentCatalogProductIds.length > 0
    ? currentCatalogProductIds.filter((productId) => coveredProductIds.has(productId)).length
    : 0;
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
    onboardingCompleted: true,
    similarityThreshold: 70,
    autoDraftHighRisk: false,
    emailNotifications: true,
  };

  const resolvedSettings = {
    ...(settings || defaultSettings),
    onboardingCompleted: true,
  } as SafetySettingRecord;

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
    settings: resolvedSettings,
    billingStatus,
    recentActivities,
    lastMonitoringAt: lastMonitoringActivityRows.find((activity: any) =>
      activity.type === "bulk" || activity.type === "automatic" || activity.action === "check"
    )?.createdAt ?? null,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { billing, session, admin } = await authenticate.admin(request);
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

  if (actionType === "importCatalogAndMonitor") {
    const billingRedirect = await requireActiveBilling(billing, session.shop, {
      allowFreeInitialScan: true,
    });
    if (billingRedirect) return billingRedirect as never;

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

      await db.safetySetting.upsert({
        where: { shop: session.shop },
        update: {
          freeScanUsed: true,
          freeScanCompletedAt: new Date(),
        },
        create: {
          shop: session.shop,
          similarityThreshold: 70,
          freeScanUsed: true,
          freeScanCompletedAt: new Date(),
        },
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

  if (actionType === "bulkCheck") {
    const billingRedirect = await requireActiveBilling(billing, session.shop);
    if (billingRedirect) return billingRedirect as never;

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

  if (actionType === "completeOnboarding") {
    const billingRedirect = await requireActiveBilling(billing, session.shop, {
      allowFreeInitialScan: true,
    });
    if (billingRedirect) return billingRedirect as never;

    const similarityThreshold = Number(formData.get("similarityThreshold") || 70);
    const onboardingCompleted = formData.get("onboardingCompleted") === "true";
    const autoDraftHighRisk = formData.get("autoDraftHighRisk") === "true";
    try {
      await db.safetySetting.upsert({
        where: { shop: session.shop },
        update: {
          similarityThreshold,
          onboardingCompleted,
          autoDraftHighRisk,
          emailNotifications: true,
        },
        create: {
          shop: session.shop,
          similarityThreshold,
          onboardingCompleted,
          autoDraftHighRisk,
          emailNotifications: true,
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
  const { stats, recentAlerts, settings, billingStatus, recentActivities, lastMonitoringAt } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<ActionResponse>();
  const navigation = useNavigation();
  const shopify = useAppBridge();
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();


  const isLoading = navigation.state === "loading";
  const isSubmitting = fetcher.state === "submitting";
  const monitoredProductLabel = `${stats.checkedProducts}/${stats.totalProducts || 0}`;
  const hasCompleteCoverage = stats.totalProducts > 0 && stats.checkedProducts >= stats.totalProducts;
  const coveragePercent = stats.totalProducts > 0
    ? Math.min(100, Math.round((stats.checkedProducts / stats.totalProducts) * 100))
    : 0;
  const closedDecisions = stats.resolvedAlerts + stats.dismissedAlerts;
  const dashboardState = stats.activeAlerts > 0
    ? "review-needed"
    : stats.totalProducts === 0
      ? "no-action-needed"
      : !hasCompleteCoverage
        ? "coverage-incomplete"
        : !lastMonitoringAt
          ? "monitoring-problem"
          : "no-action-needed";
  const dashboardStatus = {
    "review-needed": {
      tone: stats.criticalActiveAlerts > 0 ? "critical" : "warning",
      eyebrow: stats.criticalActiveAlerts > 0
        ? t("dashboard.admin.status.reviewNeeded.criticalEyebrow")
        : t("dashboard.admin.status.reviewNeeded.eyebrow"),
      title: stats.criticalActiveAlerts > 0
        ? t("dashboard.admin.status.reviewNeeded.criticalTitle", { count: stats.criticalActiveAlerts })
        : t("dashboard.admin.status.reviewNeeded.title", { count: stats.activeAlerts }),
      description: stats.criticalActiveAlerts > 0
        ? t("dashboard.admin.status.reviewNeeded.criticalDescription")
        : t("dashboard.admin.status.reviewNeeded.description"),
      actionHref: recentAlerts[0]?.id
        ? `/app/alerts?status=active&open=${encodeURIComponent(recentAlerts[0].id)}`
        : "/app/alerts?status=active",
      actionLabel: t("actions.reviewAlerts"),
    },
    "coverage-incomplete": {
      tone: "warning",
      eyebrow: t("dashboard.admin.status.coverageIncomplete.eyebrow"),
      title: t("dashboard.admin.status.coverageIncomplete.title", { count: stats.uncheckedProducts }),
      description: t("dashboard.admin.status.coverageIncomplete.description", {
        checked: stats.checkedProducts,
        total: stats.totalProducts,
      }),
      actionHref: "/app/manual-check#product-catalogue",
      actionLabel: t("dashboard.admin.finishCoverage"),
    },
    "monitoring-problem": {
      tone: "critical",
      eyebrow: t("dashboard.admin.status.monitoringProblem.eyebrow"),
      title: t("dashboard.admin.status.monitoringProblem.title"),
      description: t("dashboard.admin.status.monitoringProblem.description"),
      actionHref: "/app/manual-check#product-catalogue",
      actionLabel: t("dashboard.admin.status.monitoringProblem.action"),
    },
    "no-action-needed": {
      tone: "success",
      eyebrow: t("dashboard.admin.status.noActionNeeded.eyebrow"),
      title: stats.totalProducts === 0
        ? t("dashboard.admin.status.noActionNeeded.emptyCatalogTitle")
        : t("dashboard.admin.status.noActionNeeded.title"),
      description: stats.totalProducts === 0
        ? t("dashboard.admin.status.noActionNeeded.emptyCatalogDescription")
        : t("dashboard.admin.status.noActionNeeded.description", { count: stats.checkedProducts }),
      actionHref: "/app/manual-check#product-catalogue",
      actionLabel: t("dashboard.admin.status.noActionNeeded.action"),
    },
  }[dashboardState];
  const cleanRiskLabel = (value?: string | null) =>
    value ? value.replace(/\s*\/\s*other\b/gi, "").trim() : "";

  const hasAutoStartedScan = useRef(false);
  useEffect(() => {
    // Auto-trigger free catalog scan immediately upon entry if store has unverified catalog and scan hasn't run yet
    const isScanNeeded = !settings?.freeScanUsed && stats.checkedProducts === 0;
    if (isScanNeeded && !hasAutoStartedScan.current && fetcher.state === "idle" && !fetcher.data) {
      hasAutoStartedScan.current = true;
      fetcher.submit(
        { action: "importCatalogAndMonitor" },
        { method: "POST" }
      );
    }
  }, [settings?.freeScanUsed, stats.checkedProducts, fetcher]);

  const protectedCount = Math.max(0, stats.checkedProducts - stats.activeAlerts);
  const actionRequiredCount = stats.activeAlerts;
  const unprotectedCount = stats.uncheckedProducts;
  const isScanning = isSubmitting || fetcher.state !== "idle";

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
  // STANDARD DASHBOARD VIEW (Direct access, zero onboarding blocker)
  // ═══════════════════════════════════════════════════════════════════════════
  return (
    <s-page size="large" className="page-shell" suppressHydrationWarning>
      <s-heading slot="title" size="large" suppressHydrationWarning>{t('dashboard.title')}</s-heading>
      <s-button
        slot="primary-action"
        variant="primary"
        onClick={() => navigate(dashboardStatus.actionHref)}
        suppressHydrationWarning
      >
        {dashboardStatus.actionLabel}
      </s-button>
      <s-button slot="secondary-actions" variant="secondary" onClick={() => navigate("/app/audit-report")} suppressHydrationWarning>
        {t("actions.auditReport")}
      </s-button>
      <s-button slot="secondary-actions" variant="secondary" onClick={() => navigate("/app/evidence")} suppressHydrationWarning>
        {t("actions.viewEvidence")}
      </s-button>

      <div className="admin-stack">
        {/* Live Scan Progress Card when scan is active */}
        {isScanning && (
          <section className="live-scan-card" aria-live="polite">
            <div className="live-scan-header">
              <div>
                <p className="admin-eyebrow" style={{ margin: 0, color: "#008060" }}>
                  {t("dashboard.liveScan.eyebrow")}
                </p>
                <h3 style={{ margin: "4px 0 0", fontSize: "18px", fontWeight: 600 }}>
                  {t("dashboard.liveScan.heading")}
                </h3>
              </div>
              <span className="live-scan-badge">
                <s-spinner size="small" />
                {t("dashboard.liveScan.inProgress")}
              </span>
            </div>
            <p style={{ margin: "6px 0 0", fontSize: "13px", color: "var(--text-subdued)", maxWidth: "75ch" }}>
              {t("dashboard.liveScan.description")}
            </p>
            <div className="live-scan-steps">
              <div className="live-scan-step live-scan-step--done">
                <span className="live-scan-step-icon live-scan-step-icon--done">✓</span>
                <span>{t("dashboard.liveScan.stepImport")}</span>
              </div>
              <div className="live-scan-step live-scan-step--active">
                <span className="live-scan-step-icon live-scan-step-icon--active">
                  <s-spinner size="small" />
                </span>
                <span>{t("dashboard.liveScan.stepScan")}</span>
              </div>
              <div className="live-scan-step">
                <span className="live-scan-step-icon live-scan-step-icon--pending">3</span>
                <span style={{ color: "var(--text-subdued)" }}>{t("dashboard.liveScan.stepAudit")}</span>
              </div>
            </div>
          </section>
        )}

        {/* 3-Card Catalog Safety Status Breakdown */}
        <section aria-label={t("dashboard.safetyBreakdown.eyebrow")}>
          <div style={{ marginBottom: "12px" }}>
            <p className="admin-eyebrow" style={{ margin: 0 }}>{t("dashboard.safetyBreakdown.eyebrow")}</p>
            <h2 style={{ margin: "4px 0 0", fontSize: "20px", fontWeight: 600 }}>{t("dashboard.safetyBreakdown.title")}</h2>
            <p style={{ margin: "4px 0 0", fontSize: "13px", color: "var(--text-subdued)" }}>{t("dashboard.safetyBreakdown.description")}</p>
          </div>

          <div className="safety-status-grid">
            {/* 1. Protected Card (Green) */}
            <div className="safety-status-card safety-status-card--protected">
              <div>
                <div className="safety-status-card__top">
                  <span className="safety-status-card__badge safety-status-card__badge--protected">
                    🟢 {t("status.protected")}
                  </span>
                  <small style={{ color: "var(--text-subdued)", fontSize: "12px" }}>
                    {stats.totalProducts > 0 ? `${Math.round((protectedCount / Math.max(1, stats.totalProducts)) * 100)}%` : "0%"}
                  </small>
                </div>
                <div className="safety-status-card__value" style={{ color: "#108043" }}>
                  {protectedCount}
                </div>
                <div className="safety-status-card__label">
                  {t("dashboard.safetyBreakdown.protectedLabel")}
                </div>
                <div className="safety-status-card__desc">
                  {t("dashboard.safetyBreakdown.protectedDesc")}
                </div>
              </div>
              <div className="safety-status-card__action">
                <s-button
                  variant="secondary"
                  onClick={() => navigate("/app/evidence")}
                >
                  {t("actions.viewEvidence")}
                </s-button>
              </div>
            </div>

            {/* 2. Action Required Card (Red / Critical) */}
            <div className="safety-status-card safety-status-card--action">
              <div>
                <div className="safety-status-card__top">
                  <span className="safety-status-card__badge safety-status-card__badge--action">
                    🔴 {t("status.actionRequired")}
                  </span>
                  <small style={{ color: "var(--text-subdued)", fontSize: "12px" }}>
                    {stats.criticalActiveAlerts > 0 ? `${stats.criticalActiveAlerts} critical` : ""}
                  </small>
                </div>
                <div className="safety-status-card__value" style={{ color: actionRequiredCount > 0 ? "#d82c0d" : "inherit" }}>
                  {actionRequiredCount}
                </div>
                <div className="safety-status-card__label">
                  {t("dashboard.safetyBreakdown.actionLabel")}
                </div>
                <div className="safety-status-card__desc">
                  {t("dashboard.safetyBreakdown.actionDesc")}
                </div>
              </div>
              <div className="safety-status-card__action">
                <s-button
                  variant={actionRequiredCount > 0 ? "primary" : "secondary"}
                  tone={actionRequiredCount > 0 ? "critical" : undefined}
                  onClick={() => navigate("/app/alerts?status=active")}
                >
                  {t("dashboard.safetyBreakdown.reviewAlertsAction")}
                </s-button>
              </div>
            </div>

            {/* 3. Unprotected Card (Yellow / Amber) */}
            <div className="safety-status-card safety-status-card--unprotected">
              <div>
                <div className="safety-status-card__top">
                  <span className="safety-status-card__badge safety-status-card__badge--unprotected">
                    🟡 {t("status.unprotected")}
                  </span>
                  <small style={{ color: "var(--text-subdued)", fontSize: "12px" }}>
                    {unprotectedCount > 0 ? `${unprotectedCount} pending` : "All clear"}
                  </small>
                </div>
                <div className="safety-status-card__value" style={{ color: unprotectedCount > 0 ? "#b98900" : "#108043" }}>
                  {unprotectedCount}
                </div>
                <div className="safety-status-card__label">
                  {t("dashboard.safetyBreakdown.unprotectedLabel")}
                </div>
                <div className="safety-status-card__desc">
                  {unprotectedCount > 0
                    ? t("dashboard.safetyBreakdown.unprotectedDesc")
                    : t("dashboard.safetyBreakdown.unprotectedAllCovered")}
                </div>
              </div>
              <div className="safety-status-card__action">
                {unprotectedCount > 0 ? (
                  <s-button
                    variant="primary"
                    onClick={() =>
                      fetcher.submit(
                        { action: "importCatalogAndMonitor" },
                        { method: "POST" }
                      )
                    }
                    disabled={isScanning}
                  >
                    {t("dashboard.safetyBreakdown.protectRemainingAction", { count: unprotectedCount })}
                  </s-button>
                ) : (
                  <s-button
                    variant="secondary"
                    onClick={() =>
                      fetcher.submit(
                        { action: "importCatalogAndMonitor" },
                        { method: "POST" }
                      )
                    }
                    disabled={isScanning}
                  >
                    {t("dashboard.safetyBreakdown.scanAllAction")}
                  </s-button>
                )}
              </div>
            </div>
          </div>
        </section>
        {billingStatus && !billingStatus.hasActivePayment && billingStatus.freeScanUsed && (
          <s-banner tone="warning" heading={t("billing.upgradeRequiredHeading")}>
            <s-text>{t("billing.upgradeRequiredDescription")}</s-text>
            <div style={{ marginTop: "var(--s-space-300)" }}>
              <s-button
                variant="primary"
                onClick={() => {
                  window.open(billingStatus.pricingPlansUrl, "_top");
                }}
                suppressHydrationWarning
              >
                {t("billing.upgradePlanButton")}
              </s-button>
            </div>
          </s-banner>
        )}
        <section className={`dashboard-status-panel dashboard-status-panel--${dashboardStatus.tone}`}>
          <div className="dashboard-status-panel__content">
            <p className="admin-eyebrow">{dashboardStatus.eyebrow}</p>
            <h2 className="dashboard-status-panel__title">{dashboardStatus.title}</h2>
            <p className="dashboard-status-panel__description">{dashboardStatus.description}</p>
            <div className="dashboard-status-panel__actions">
              <s-button variant="primary" onClick={() => navigate(dashboardStatus.actionHref)}>
                {dashboardStatus.actionLabel}
              </s-button>
              {stats.uncheckedProducts > 0 && (
                <s-button variant="secondary" onClick={() => navigate("/app/manual-check")}>
                  {t("dashboard.admin.protectRemainingProducts", { count: stats.uncheckedProducts })}
                </s-button>
              )}
              <s-button variant="secondary" onClick={() => navigate("/app/evidence")}>
                {t("actions.viewEvidence")}
              </s-button>
            </div>
          </div>
          <div className="dashboard-status-panel__facts" aria-label={t("dashboard.admin.status.factsLabel")}>
            <div className="dashboard-status-panel__fact">
              <span>{t("dashboard.admin.productsMonitored")}</span>
              <strong>{monitoredProductLabel}</strong>
              <small>{coveragePercent}% {t("dashboard.admin.coveragePercent").toLowerCase()}</small>
            </div>
            <div className="dashboard-status-panel__fact">
              <span>{t("dashboard.admin.status.matchesNeedingReview")}</span>
              <strong>{stats.activeAlerts}</strong>
              <small>{stats.activeAlerts > 0 ? t("status.needsReview") : t("dashboard.admin.status.none")}</small>
            </div>
            <div className="dashboard-status-panel__fact">
              <span>{t("dashboard.admin.lastSafetyGateUpdateChecked")}</span>
              <strong>{lastMonitoringAt ? formatRelativeDate(new Date(lastMonitoringAt), t, i18n.language) : t("status.notChecked")}</strong>
              <small>{t("dashboard.admin.status.cachedEvidence")}</small>
            </div>
            <div className="dashboard-status-panel__fact">
              <span>{t("dashboard.admin.nextAutomaticCheck")}</span>
              <strong>{t("dashboard.admin.dailyAtTime")}</strong>
              <small>{t("dashboard.admin.status.deltaMonitoring")}</small>
            </div>
          </div>
        </section>

        <section className="protection-value-panel" aria-label={t("dashboard.admin.proofGridLabel")}>
          <div className="protection-value-panel__content">
            <p className="admin-eyebrow">{t("dashboard.admin.protectionEyebrow")}</p>
            <h2 className="protection-value-panel__title">{t("dashboard.admin.protectionTitle")}</h2>
            <p className="protection-value-panel__description">{t("dashboard.admin.protectionDescription")}</p>
          </div>
          <div className="protection-proof-grid">
            <div className="protection-proof-item protection-proof-item--primary">
              <span>{t("dashboard.admin.valueMetrics.productsCovered")}</span>
              <strong>{stats.checkedProducts}/{stats.totalProducts || 0}</strong>
              <small>{t("dashboard.admin.productsCoveredShort")}</small>
            </div>
            <div className="protection-proof-item">
              <span>{t("dashboard.admin.valueMetrics.checksRun")}</span>
              <strong>{stats.totalChecks}</strong>
              <small>{t("dashboard.admin.allTimeChecksDescription")}</small>
            </div>
            <div className="protection-proof-item">
              <span>{t("dashboard.admin.valueMetrics.decisionsRecorded")}</span>
              <strong>{closedDecisions}</strong>
              <small>{t("dashboard.admin.auditHistoryKept")}</small>
            </div>
          </div>
        </section>

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
                <s-button variant="secondary" onClick={() => navigate("/app/manual-check#product-catalogue")}>
                  {t("actions.checkOneProduct")}
                </s-button>
                <s-button variant="secondary" onClick={() => navigate("/app/alerts")}>
                  {t("actions.viewAlerts")}
                </s-button>
              </div>
            </div>

            {recentAlerts.length === 0 ? (
              <div className="admin-empty-state">
                <h3>{t("dashboard.admin.noAlertsTitle")}</h3>
                <p>{t("dashboard.admin.noAlertsDescription")}</p>
                <div className="empty-value-proof">
                  <span>{t("dashboard.admin.emptyProofMonitoring")}</span>
                  <span>{t("dashboard.admin.emptyProofEvidence", { count: closedDecisions })}</span>
                  <span>{t("dashboard.admin.emptyProofCoverage", { count: stats.checkedProducts })}</span>
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
                      <s-button variant="secondary" onClick={() => navigate(`/app/alerts?status=active&open=${encodeURIComponent(alert.id)}`)}>
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
