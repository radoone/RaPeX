import { useEffect, useRef } from "react";
import { randomUUID } from "node:crypto";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData, useNavigation, useNavigate, useRevalidator, useRouteError, isRouteErrorResponse } from "react-router";
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
  startMerchantCatalogAudit,
} from "../services/safety-gate-checker.server";
import { checkCoversCurrentProductVersion } from "../services/catalog-coverage.server";
import { getRecentMonitoringRuns } from "../services/monitoring-runs.server";
import { mirrorOfflineSessionForCatalogAudit } from "../services/catalog-audit-session.server";

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

type CatalogAuditProgress = {
  status: string | null;
  productsFetched: number;
  productsImported: number;
  productsScanned: number;
  alertsScanned: number;
  failureCode: string | null;
};

async function fetchCurrentCatalogProductVersions(admin: any): Promise<Array<{ id: string; updatedAt: string | null }>> {
  const productVersions: Array<{ id: string; updatedAt: string | null }> = [];
  let after: string | null = null;
  let hasNextPage = true;
  while (hasNextPage) {
    const response: { json: () => Promise<any> } = await admin.graphql(`#graphql
      query dashboardCatalogProductIds($first: Int!, $after: String) {
        products(first: $first, after: $after) {
          pageInfo { hasNextPage endCursor }
          nodes { id updatedAt }
        }
      }
    `, { variables: { first: 250, after } });
    const payload = await response.json();
    if (payload.errors?.length) throw new Error(payload.errors[0]?.message || "Could not load Shopify catalog versions");
    const connection = payload.data?.products;
    const nodes = (connection?.nodes || []) as Array<{ id: string; updatedAt?: string | null }>;
    productVersions.push(...nodes.map((product) => ({
      id: product.id.replace("gid://shopify/Product/", ""),
      updatedAt: product.updatedAt || null,
    })));
    hasNextPage = Boolean(connection?.pageInfo?.hasNextPage);
    after = connection?.pageInfo?.endCursor || null;
    if (hasNextPage && !after) throw new Error("Shopify catalog page did not include its next cursor");
  }
  return productVersions;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { billing, session, admin } = await authenticate.admin(request);
  const billingStatus = await getBillingStatus(billing, session.shop, admin);

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
      orderBy: { checkedAt: "desc" },
      select: { productId: true, checkedAt: true, sourceUpdatedAt: true },
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
    fetchCurrentCatalogProductVersions(admin),
  ]);

  const monitorStateSnapshot = await firestore
    .collection("merchants")
    .doc(encodeURIComponent(session.shop))
    .get();
  const monitorState = monitorStateSnapshot.exists ? monitorStateSnapshot.data() : null;
  const recentMonitoringRuns = await getRecentMonitoringRuns(session.shop).catch((error) => {
    console.error("Could not load recent Safety Gate monitoring runs", { shop: session.shop, error });
    return [];
  });

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

  const checksByProduct = new Map<string, any[]>();
  for (const check of checkedProductIds) {
    if (!check.productId) continue;
    const productChecks = checksByProduct.get(check.productId) || [];
    productChecks.push(check);
    checksByProduct.set(check.productId, productChecks);
  }
  const checkedProductCount = currentCatalogProductIds.filter((product) =>
    (checksByProduct.get(product.id) || []).some((check) =>
      checkCoversCurrentProductVersion(check, product.updatedAt),
    ),
  ).length;
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
    recentMonitoringRuns,
    monitorState: monitorState ? {
      status: monitorState.lastMonitorStatus || null,
      lastRunAt: monitorState.lastMonitorRunEnd || null,
      lastError: monitorState.lastMonitorStatus === "FAILURE" ? monitorState.lastError || null : null,
    } : null,
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
      admin,
    });
    if (billingRedirect) return billingRedirect as never;
    const currentBillingStatus = await getBillingStatus(billing, session.shop, admin);
    const runId = randomUUID();

    const merchantRef = firestore.collection("merchants").doc(encodeURIComponent(session.shop));
    const reserved = await firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(merchantRef);
      const settings = (snapshot.data() || {}) as Record<string, unknown>;
      const previousStartedAt = settings.initialScanStartedAt instanceof Date
        ? settings.initialScanStartedAt
        : typeof (settings.initialScanStartedAt as { toDate?: unknown } | undefined)?.toDate === "function"
          ? (settings.initialScanStartedAt as { toDate: () => Date }).toDate()
          : null;
      const reservationIsLive = settings.initialScanStatus === "scanning" &&
        Boolean(previousStartedAt && Date.now() - previousStartedAt.getTime() < 30 * 60 * 1000);
      const freeScanAlreadyUsed = settings.freeScanUsed === true &&
        !currentBillingStatus.hasActivePayment && !currentBillingStatus.developmentBypass;
      if (reservationIsLive || freeScanAlreadyUsed) return false;
      transaction.set(merchantRef, {
        shop: session.shop,
        similarityThreshold: Number(settings.similarityThreshold || 70),
        initialScanStatus: "scanning",
        initialScanStartedAt: new Date(),
        initialScanRunId: runId,
        initialScanProductsFetched: 0,
        initialScanProductsImported: 0,
        initialScanProductsScanned: 0,
        initialScanAlertsScanned: 0,
        initialScanFailureCode: null,
        updatedAt: new Date(),
      }, { merge: true });
      return true;
    });
    if (!reserved) {
      return json({ success: false, error: "A catalog check is already running or the free initial scan has already been used." }, { status: 409 });
    }

    try {
      await mirrorOfflineSessionForCatalogAudit(session.shop);
      await startMerchantCatalogAudit(session.shop, runId);
      return json({ success: true, message: "Catalog safety scan started" });
    } catch (error) {
      console.error("Could not queue initial Safety Gate catalog scan", { shop: session.shop, error });
      await firestore.collection("merchants").doc(encodeURIComponent(session.shop)).set({
        initialScanStatus: "failed",
        initialScanFailureCode: "enqueue_failed",
        updatedAt: new Date(),
      }, { merge: true });
      return json({ success: false, error: "Could not start the catalog check. Please try again." }, { status: 503 });
    }
  }

  if (actionType === "bulkCheck") {
    const billingRedirect = await requireActiveBilling(billing, session.shop, { admin });
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
  const { stats, recentAlerts, settings, billingStatus, recentActivities, lastMonitoringAt, monitorState, recentMonitoringRuns } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<ActionResponse>();
  const progressFetcher = useFetcher<CatalogAuditProgress>();
  const navigation = useNavigation();
  const revalidator = useRevalidator();
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
        : monitorState?.status === "FAILURE" || monitorState?.status === "IN_PROGRESS" || !lastMonitoringAt
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
  const refreshedAfterAudit = useRef(false);
  const loadAuditProgress = progressFetcher.load;
  useEffect(() => {
    // Start first-run protection without asking the merchant to discover a
    // secondary dashboard action. Paid stores may retry an interrupted first
    // import; free stores retain their one-scan billing limit.
    const completedWithoutChecks = settings?.initialScanStatus === "completed" &&
      stats.totalProducts > 0 &&
      stats.checkedProducts === 0;
    const canRetryInitialScan = Boolean(billingStatus?.developmentBypass) ||
      Boolean(billingStatus?.billingVerified && (billingStatus.hasActivePayment || !settings?.freeScanUsed || completedWithoutChecks));
    const isScanNeeded = stats.totalProducts > 0 &&
      stats.uncheckedProducts > 0 &&
      canRetryInitialScan &&
      settings?.initialScanStatus !== "scanning" &&
      (settings?.initialScanStatus !== "completed" || completedWithoutChecks);
    if (isScanNeeded && !hasAutoStartedScan.current && fetcher.state === "idle" && !fetcher.data) {
      hasAutoStartedScan.current = true;
      fetcher.submit(
        { action: "importCatalogAndMonitor" },
        { method: "POST" }
      );
    }
  }, [
    billingStatus?.hasActivePayment,
    billingStatus?.billingVerified,
    billingStatus?.developmentBypass,
    settings?.freeScanUsed,
    settings?.initialScanStatus,
    stats.totalProducts,
    stats.checkedProducts,
    stats.uncheckedProducts,
    fetcher,
  ]);

  useEffect(() => {
    const observedStatus = progressFetcher.data?.status;
    if (observedStatus === "completed" || observedStatus === "failed") return;
    const shouldPoll = observedStatus === "scanning" ||
      (!observedStatus && (settings?.initialScanStatus === "scanning" || fetcher.data?.success));
    if (!shouldPoll) return;
    loadAuditProgress("/api/catalog-audit-status");
    const timer = window.setInterval(() => loadAuditProgress("/api/catalog-audit-status"), 7000);
    return () => window.clearInterval(timer);
  }, [settings?.initialScanStatus, progressFetcher.data?.status, fetcher.data?.success, loadAuditProgress]);

  const scanStatus = progressFetcher.data?.status || settings?.initialScanStatus;
  useEffect(() => {
    if (scanStatus !== "completed") {
      refreshedAfterAudit.current = false;
      return;
    }
    if (!refreshedAfterAudit.current && settings?.initialScanStatus === "scanning") {
      refreshedAfterAudit.current = true;
      revalidator.revalidate();
    }
  }, [scanStatus, settings?.initialScanStatus, revalidator]);

  const isScanning = isSubmitting || fetcher.state !== "idle" || scanStatus === "scanning";

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
  const shouldShowPrimaryAction = !isScanning && dashboardState === "review-needed";

  return (
    <s-page size="large" className="page-shell" suppressHydrationWarning>
      <s-heading slot="title" size="large" suppressHydrationWarning>{t('dashboard.title')}</s-heading>
      {shouldShowPrimaryAction ? (
        <s-button
          slot="primary-action"
          variant="primary"
          onClick={() => navigate(dashboardStatus.actionHref)}
          suppressHydrationWarning
        >
          {dashboardStatus.actionLabel}
        </s-button>
      ) : null}

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
            {progressFetcher.data ? (
              <p style={{ margin: "8px 0 0", fontSize: "13px", color: "var(--text-subdued)" }}>
                {t("dashboard.liveScan.progress", {
                  imported: progressFetcher.data.productsImported,
                  fetched: progressFetcher.data.productsFetched,
                  scanned: progressFetcher.data.productsScanned,
                  alerts: progressFetcher.data.alertsScanned,
                })}
              </p>
            ) : null}
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

        {!isScanning ? <>
        {scanStatus === "failed" && (
          <s-banner tone="warning" heading={t("dashboard.liveScan.failedHeading")}>
            <s-text>{t("dashboard.liveScan.failedDescription")}</s-text>
            <div style={{ marginTop: "var(--s-space-200)" }}>
              <s-button variant="secondary" onClick={() => window.location.reload()}>{t("actions.retry")}</s-button>
            </div>
          </s-banner>
        )}
        {billingStatus && !billingStatus.developmentBypass && !billingStatus.billingVerified && (
          <s-banner tone="warning" heading={t("billing.statusUnverified")}>
            <s-text>{t("billing.verificationError")}</s-text>
            <div style={{ marginTop: "var(--s-space-300)" }}>
              <s-button variant="secondary" onClick={() => window.location.reload()}>{t("actions.retry")}</s-button>
            </div>
          </s-banner>
        )}
        {billingStatus && !billingStatus.developmentBypass && billingStatus.billingVerified && !billingStatus.hasActivePayment && billingStatus.freeScanUsed && (
          <s-banner tone="warning" heading={t("billing.upgradeRequiredHeading")}>
            <s-text>{t("billing.upgradeRequiredDescription")}</s-text>
            <div style={{ marginTop: "var(--s-space-300)" }}>
              <s-button
                variant="primary"
                onClick={() => billingStatus.pricingPlansUrl && window.open(billingStatus.pricingPlansUrl, "_top")}
                disabled={!billingStatus.pricingPlansUrl}
                suppressHydrationWarning
              >
                {t("billing.upgradePlanButton")}
              </s-button>
            </div>
          </s-banner>
        )}
        {!isScanning && monitorState?.status === "FAILURE" ? (
          <s-banner tone="critical" heading={t("dashboard.admin.status.monitoringProblem.title")}>
            <s-text>{t("dashboard.admin.status.monitoringProblem.description")}</s-text>
            <div style={{ marginTop: "var(--s-space-200)" }}>
              <s-button variant="primary" href="/app/manual-check">{t("dashboard.admin.status.monitoringProblem.action")}</s-button>
            </div>
          </s-banner>
        ) : null}
        {!isScanning ? <section className={`dashboard-status-panel dashboard-status-panel--${dashboardStatus.tone}`}>
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
              <strong>{monitorState?.lastRunAt ? formatRelativeDate(new Date(monitorState.lastRunAt), t, i18n.language) : lastMonitoringAt ? formatRelativeDate(new Date(lastMonitoringAt), t, i18n.language) : t("status.notChecked")}</strong>
              <small>{t("dashboard.admin.status.cachedEvidence")}</small>
            </div>
            <div className="dashboard-status-panel__fact">
              <span>{t("dashboard.admin.nextAutomaticCheck")}</span>
              <strong>{t("dashboard.admin.dailyAtTime")}</strong>
              <small>{t("dashboard.admin.status.deltaMonitoring")}</small>
            </div>
          </div>
        </section> : null}

        {!isScanning ? <s-section heading={t("dashboard.admin.monitoringRunHistoryTitle")}>
          {recentMonitoringRuns.length === 0 ? (
            <s-text>{t("dashboard.admin.monitoringRunHistoryEmpty")}</s-text>
          ) : (
            <div className="monitoring-run-list" aria-label={t("dashboard.admin.monitoringRunHistoryTitle")}>
              {recentMonitoringRuns.map((run) => {
                const statusKey = ["queued", "processing", "retrying", "completed", "failed", "enqueue_failed", "skipped_unentitled"].includes(run.status)
                  ? run.status
                  : "unknown";
                const tone = run.status === "completed" ? "success" :
                  run.status === "failed" || run.status === "enqueue_failed" ? "critical" :
                    run.status === "skipped_unentitled" ? "warning" : "info";
                return (
                  <div className="monitoring-run-list__row" key={run.id}>
                    <div className="monitoring-run-list__summary">
                      <s-badge tone={tone}>{t(`dashboard.admin.monitoringRunStatus.${statusKey}`)}</s-badge>
                      <span>{t("dashboard.admin.monitoringRunProgress", {
                        products: run.productsScanned,
                        alerts: run.alertsCreated,
                      })}</span>
                    </div>
                    <small>
                      {run.updatedAt
                        ? formatRelativeDate(new Date(run.updatedAt), t, i18n.language)
                        : t("dashboard.admin.monitoringRunDateUnknown")}
                    </small>
                  </div>
                );
              })}
            </div>
          )}
        </s-section> : null}

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
        </> : null}
      </div>
    </s-page>
  );
}
