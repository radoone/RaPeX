import { AdminCard } from "../components/AdminCard";
import { LocalDateTime } from "../components/LocalDateTime";
import { useEffect, useRef, useState } from "react";
import { randomUUID } from "node:crypto";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  useFetcher,
  useLoaderData,
  useNavigation,
  useRevalidator,
  useRouteError,
  isRouteErrorResponse,
} from "react-router";
import { data as json } from "react-router";
import { Trans, useTranslation } from "react-i18next";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import db, { type SafetySettingRecord } from "../merchant-db.server";
import { firestore } from "../firestore.server";
import { formatRelativeDate } from "../components";
import { compareReviewPriority } from "../services/review-priority";
import { isWaitingForSupplier } from "../services/review-evidence";
import {
  getBillingStatus,
  requireActiveBilling,
} from "../services/billing.server";
import {
  runMerchantDeltaMonitoring,
  startMerchantCatalogAudit,
} from "../services/safety-gate-checker.server";
import { catalogCheckStates } from "../services/catalog-state";
import { monitoringState } from "../services/monitoring-state";
import { getRecentMonitoringRuns } from "../services/monitoring-runs.server";
import { toIsoString } from "../services/monitoring-runs";
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
    status: "checked" | "skipped" | "error" | "alert_created";
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
  phase: "import" | "monitor" | null;
  runStatus: string | null;
  status: string | null;
  productsFetched: number;
  productsImported: number;
  productsScanned: number;
  alertsScanned: number;
  failureCode: string | null;
};

async function fetchCurrentCatalogProductVersions(
  admin: any,
): Promise<Array<{ id: string; updatedAt: string | null }>> {
  const productVersions: Array<{ id: string; updatedAt: string | null }> = [];
  let after: string | null = null;
  let hasNextPage = true;
  while (hasNextPage) {
    const response: { json: () => Promise<any> } = await admin.graphql(
      `#graphql
      query dashboardCatalogProductIds($first: Int!, $after: String) {
        products(first: $first, after: $after) {
          pageInfo { hasNextPage endCursor }
          nodes { id updatedAt }
        }
      }
    `,
      { variables: { first: 250, after } },
    );
    const payload = await response.json();
    if (payload.errors?.length)
      throw new Error(
        payload.errors[0]?.message || "Could not load Shopify catalog versions",
      );
    const connection = payload.data?.products;
    const nodes = (connection?.nodes || []) as Array<{
      id: string;
      updatedAt?: string | null;
    }>;
    productVersions.push(
      ...nodes.map((product) => ({
        id: product.id.replace("gid://shopify/Product/", ""),
        updatedAt: product.updatedAt || null,
      })),
    );
    hasNextPage = Boolean(connection?.pageInfo?.hasNextPage);
    after = connection?.pageInfo?.endCursor || null;
    if (hasNextPage && !after)
      throw new Error("Shopify catalog page did not include its next cursor");
  }
  return productVersions;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { billing, session, admin } = await authenticate.admin(request);
  const billingStatus = await getBillingStatus(billing, session.shop, admin);

  const [
    recentAlerts,
    checkedProductIds,
    storedSettings,
    currentCatalogProductIds,
  ] = await Promise.all([
    db.safetyAlert.findMany({
      where: { shop: session.shop, status: "active" },
    }),
    // Get list of already checked product IDs
    db.safetyCheck.findMany({
      where: { shop: session.shop },
      orderBy: { checkedAt: "desc" },
      select: { productId: true, checkedAt: true, sourceUpdatedAt: true },
    }),
    db.safetySetting.findUnique({
      where: { shop: session.shop },
    }),
    fetchCurrentCatalogProductVersions(admin),
  ]);

  const pendingReview = recentAlerts.filter(alert => !isWaitingForSupplier(alert));
  pendingReview.sort(compareReviewPriority);
  const nextReviewAlertId = pendingReview[0]?.id || null;
  const monitorStateSnapshot = await firestore
    .collection("merchants")
    .doc(encodeURIComponent(session.shop))
    .get();
  const monitorState = monitorStateSnapshot.exists
    ? monitorStateSnapshot.data()
    : null;
  const recentMonitoringRuns = await getRecentMonitoringRuns(
    session.shop,
  ).catch((error) => {
    console.error("Could not load recent Safety Gate monitoring runs", {
      shop: session.shop,
      error,
    });
    return [];
  });

  let settings = storedSettings;
  if (
    !settings ||
    settings.emailNotifications === undefined ||
    !settings.notificationEmail
  ) {
    let shopifyEmail: string | null = null;
    try {
      const response = await admin.graphql(`#graphql
        query dashboardNotificationContactEmail { shop { contactEmail email } }
      `);
      const payload = await response.json();
      const candidate = String(
        payload.data?.shop?.contactEmail || payload.data?.shop?.email || "",
      )
        .trim()
        .toLowerCase();
      shopifyEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate)
        ? candidate
        : null;
    } catch (error) {
      console.warn(
        "Could not initialize notification email from Shopify",
        error,
      );
    }
    settings = await db.safetySetting.upsert({
      where: { shop: session.shop },
      update: {
        ...(settings?.emailNotifications === undefined
          ? { emailNotifications: true }
          : {}),
        ...(!settings?.notificationEmail && shopifyEmail
          ? {
              notificationEmail: shopifyEmail,
              notificationEmailSource: "shopify" as const,
            }
          : {}),
        ...(!settings?.notificationLanguage
          ? { notificationLanguage: "en" }
          : {}),
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

  const totalProductsCount = currentCatalogProductIds.length;
  const productStates = catalogCheckStates(
    currentCatalogProductIds,
    checkedProductIds,
  );
  const checkedProductCount = Object.values(productStates).filter(
    (item) => item.state === "current",
  ).length;
  const uncheckedProductCount = totalProductsCount - checkedProductCount;
  const criticalActiveAlerts = pendingReview.filter((alert: any) => {
    try {
      const parsed = alert.checkResult ? JSON.parse(alert.checkResult) : null;
      const warning = Array.isArray(parsed?.warnings)
        ? parsed.warnings[0]
        : null;
      const level = String(
        warning?.alertDetails?.fields?.alert_level ||
          warning?.alertDetails?.fields?.risk_level ||
          warning?.riskLevel ||
          alert.riskLevel ||
          "",
      ).toLowerCase();
      return (
        level.includes("serious") ||
        level.includes("high") ||
        level === "1" ||
        level === "2"
      );
    } catch {
      const level = String(alert.riskLevel || "").toLowerCase();
      return (
        level.includes("serious") ||
        level.includes("high") ||
        level === "1" ||
        level === "2"
      );
    }
  }).length;

  const lastMonitoringAt =
    recentMonitoringRuns.find((run) => run.status === "completed" && run.updatedAt)
      ?.updatedAt ||
    (monitorState?.lastMonitorStatus === "SUCCESS"
      ? toIsoString(monitorState.lastMonitorRunEnd)
      : null);
  const lastAuditAt = toIsoString(monitorState?.initialScanCompletedAt);

  const defaultSettings: Partial<SafetySettingRecord> & {
    onboardingCompleted: boolean;
  } = {
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
      activeAlerts: pendingReview.length,
      waitingForSupplier: recentAlerts.length - pendingReview.length,
      totalProducts: totalProductsCount,
      checkedProducts: checkedProductCount,
      uncheckedProducts: uncheckedProductCount,
      criticalActiveAlerts,
    },
    nextReviewAlertId,
    settings: resolvedSettings,
    billingStatus,
    recentMonitoringRuns,
    observedAt: Date.now(),
    lastMonitorStatus: monitorState?.lastMonitorStatus || null,
    lastMonitoringAt,
    lastAuditAt,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { billing, session, admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const actionType = formData.get("action");
  const includeAlreadyChecked =
    formData.get("includeAlreadyChecked") === "true";
  const monitoringModeValue = formData.get("monitoringMode");
  const monitoringMode =
    typeof monitoringModeValue === "string" && monitoringModeValue.trim()
      ? monitoringModeValue.trim()
      : "since-last-check";
  const monitoringDaysValue = formData.get("monitoringDays");
  const monitoringDays =
    typeof monitoringDaysValue === "string" && monitoringDaysValue.trim()
      ? Number(monitoringDaysValue)
      : undefined;

  if (actionType === "importCatalogAndMonitor") {
    const billingRedirect = await requireActiveBilling(billing, session.shop, {
      allowFreeInitialScan: true,
      admin,
    });
    if (billingRedirect) return billingRedirect as never;
    const currentBillingStatus = await getBillingStatus(
      billing,
      session.shop,
      admin,
    );
    const runId = randomUUID();

    const merchantRef = firestore
      .collection("merchants")
      .doc(encodeURIComponent(session.shop));
    const reserved = await firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(merchantRef);
      const settings = (snapshot.data() || {}) as Record<string, unknown>;
      const previousStartedAt =
        settings.initialScanStartedAt instanceof Date
          ? settings.initialScanStartedAt
          : typeof (
                settings.initialScanStartedAt as
                  { toDate?: unknown } | undefined
              )?.toDate === "function"
            ? (settings.initialScanStartedAt as { toDate: () => Date }).toDate()
            : null;
      const reservationIsLive =
        settings.initialScanStatus === "scanning" &&
        Boolean(
          previousStartedAt &&
          Date.now() - previousStartedAt.getTime() < 30 * 60 * 1000,
        );
      const freeScanAlreadyUsed =
        settings.freeScanUsed === true &&
        !currentBillingStatus.hasActivePayment &&
        !currentBillingStatus.developmentBypass && !currentBillingStatus.ownerTestAccess;
      if (reservationIsLive || freeScanAlreadyUsed) return false;
      transaction.set(
        merchantRef,
        {
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
        },
        { merge: true },
      );
      return true;
    });
    if (!reserved) {
      return json(
        {
          success: false,
          error:
            "A catalog check is already running or the free initial scan has already been used.",
        },
        { status: 409 },
      );
    }

    try {
      await mirrorOfflineSessionForCatalogAudit(session.shop);
      await startMerchantCatalogAudit(session.shop, runId);
      return json({ success: true, message: "Catalog safety scan started" });
    } catch (error) {
      console.error("Could not queue initial Safety Gate catalog scan", {
        shop: session.shop,
        error,
      });
      await firestore
        .collection("merchants")
        .doc(encodeURIComponent(session.shop))
        .set(
          {
            initialScanStatus: "failed",
            initialScanFailureCode: "enqueue_failed",
            updatedAt: new Date(),
          },
          { merge: true },
        );
      return json(
        {
          success: false,
          error: "Could not start the catalog check. Please try again.",
        },
        { status: 503 },
      );
    }
  }

  if (actionType === "bulkCheck") {
    const billingRedirect = await requireActiveBilling(billing, session.shop, {
      admin,
    });
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
        days:
          Number.isFinite(monitoringDays) &&
          monitoringDays &&
          monitoringDays > 0
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
        message: `Monitoring scanned ${monitoring.productsScanned} products against ${monitoring.rapexAlertsScanned} new Safety Gate alerts and created ${monitoring.alertsCreated} alerts`,
        results,
      });
    } catch (error) {
      console.error("Bulk check failed:", error);
      return json(
        {
          success: false,
          error: error instanceof Error ? error.message : "Bulk check failed",
        },
        { status: 500 },
      );
    }
  }

  if (actionType === "completeOnboarding") {
    const similarityThreshold = Number(
      formData.get("similarityThreshold") || 70,
    );
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
      return json(
        { success: false, error: "Failed to complete onboarding" },
        { status: 500 },
      );
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
      <s-heading slot="title" size="large" suppressHydrationWarning>
        {t("nav.dashboard")}
      </s-heading>
      <div className="admin-stack" style={{ marginTop: "var(--s-space-400)" }}>
        <s-banner tone="critical" heading={t("errors.pageLoadFailed")}>
          <s-text>{title}</s-text>
          <div style={{ marginTop: "var(--s-space-200)" }}>
            <s-button
              onClick={() => window.location.reload()}
              suppressHydrationWarning
            >
              {t("actions.retry")}
            </s-button>
          </div>
        </s-banner>
      </div>
    </s-page>
  );
}

export default function Index() {
  const {
    stats,
    nextReviewAlertId,
    settings,
    billingStatus,
    lastMonitoringAt,
    lastAuditAt,
    lastMonitorStatus,
    recentMonitoringRuns,
    observedAt,
  } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<ActionResponse>();
  const progressFetcher = useFetcher<CatalogAuditProgress>();
  const navigation = useNavigation();
  const revalidator = useRevalidator();
  const shopify = useAppBridge();
  const { t, i18n } = useTranslation();

  const isLoading = navigation.state === "loading";
  const isSubmitting = fetcher.state === "submitting";
  const remainingCatalogHref = "/app/manual-check?coverage=remaining#product-catalogue";
  const latestMonitoringStatus = recentMonitoringRuns[0]?.status === "completed"
    ? lastMonitorStatus
    : recentMonitoringRuns[0]?.status || lastMonitorStatus;
  const automaticStatus = monitoringState(
    billingStatus, latestMonitoringStatus, observedAt, lastMonitoringAt,
  );
  const lastCheckWasAudit = Boolean(lastAuditAt && (!lastMonitoringAt || lastAuditAt > lastMonitoringAt));
  const lastCatalogCheckAt = lastCheckWasAudit ? lastAuditAt : lastMonitoringAt;
  const monitoringNeedsRefresh = automaticStatus === "unknown" || automaticStatus === "unverified";
  const pricingPlansUrl = automaticStatus === "paused" ? billingStatus.pricingPlansUrl : null;
  const monitoringActionHref =
    automaticStatus === "enabled" || automaticStatus === "processing" || monitoringNeedsRefresh
      ? null
      : pricingPlansUrl || "/app/settings";
  const monitoringActionLabel = t(pricingPlansUrl ? "billingRedirect.openPricingPlans" : "settings.title");
  const dashboardState =
    stats.activeAlerts > 0
      ? "review-needed"
      : stats.totalProducts === 0
        ? "empty"
        : stats.uncheckedProducts > 0
          ? "coverage-incomplete"
          : automaticStatus === "enabled"
            ? "no-action-needed"
            : "monitoring-problem";
  const summary = {
    "review-needed": {
      tone: stats.criticalActiveAlerts > 0 ? "critical" : "warning",
      title: t("dashboard.admin.status.reviewNeeded.title", { count: stats.activeAlerts }),
      description: stats.criticalActiveAlerts > 0
        ? t("dashboard.admin.status.reviewNeeded.criticalDescription")
        : t("catalogOverview.reviewHelp"),
      actionHref: nextReviewAlertId
        ? `/app/alerts?status=active&open=${encodeURIComponent(nextReviewAlertId)}`
        : "/app/alerts?status=active",
      actionLabel: t("catalogOverview.reviewNext"),
    },
    "coverage-incomplete": {
      tone: "warning",
      title: t("dashboard.admin.status.coverageIncomplete.title", { count: stats.uncheckedProducts }),
      description: t("catalogOverview.coverageHelp"),
      actionHref: remainingCatalogHref,
      actionLabel: t("workspace.viewRemainingProducts", { count: stats.uncheckedProducts }),
    },
    "monitoring-problem": {
      tone: automaticStatus === "processing" ? "info" : "warning",
      title: t(`catalogOverview.monitoring.${automaticStatus}`),
      description: t(`catalogOverview.monitoringHelp.${automaticStatus}`),
      actionHref: monitoringActionHref,
      actionLabel: monitoringActionLabel,
    },
    "no-action-needed": {
      tone: "success",
      title: t("dashboard.admin.status.noActionNeeded.title"),
      description: t("catalogOverview.noActionHelp"),
      actionHref: null,
      actionLabel: "",
    },
    empty: {
      tone: "info",
      title: t("dashboard.admin.status.noActionNeeded.emptyCatalogTitle"),
      description: t("dashboard.admin.status.noActionNeeded.emptyCatalogDescription"),
      actionHref: null,
      actionLabel: "",
    },
  }[dashboardState];
  const hasAutoStartedScan = useRef(false);
  const refreshedAfterAudit = useRef(false);
  const [retryRequested, setRetryRequested] = useState(false);
  const loadAuditProgress = progressFetcher.load;
  useEffect(() => {
    // Start first-run protection without asking the merchant to discover a
    // secondary dashboard action. Paid stores may retry an interrupted first
    // import; free stores retain their one-scan billing limit.
    const completedWithoutChecks =
      settings?.initialScanStatus === "completed" &&
      stats.totalProducts > 0 &&
      stats.checkedProducts === 0;
    const canRetryInitialScan =
      Boolean(billingStatus?.developmentBypass || billingStatus?.ownerTestAccess) ||
      Boolean(
        billingStatus?.billingVerified &&
        (billingStatus.hasActivePayment ||
          !settings?.freeScanUsed ||
          completedWithoutChecks),
      );
    const isScanNeeded =
      stats.totalProducts > 0 &&
      stats.uncheckedProducts > 0 &&
      canRetryInitialScan &&
      settings?.initialScanStatus !== "scanning" &&
      settings?.initialScanStatus !== "failed" &&
      (settings?.initialScanStatus !== "completed" || completedWithoutChecks);
    if (
      isScanNeeded &&
      !hasAutoStartedScan.current &&
      fetcher.state === "idle" &&
      !fetcher.data
    ) {
      hasAutoStartedScan.current = true;
      fetcher.submit({ action: "importCatalogAndMonitor" }, { method: "POST" });
    }
  }, [
    billingStatus?.hasActivePayment,
    billingStatus?.billingVerified,
    billingStatus?.developmentBypass,
    billingStatus?.ownerTestAccess,
    settings?.freeScanUsed,
    settings?.initialScanStatus,
    stats.totalProducts,
    stats.checkedProducts,
    stats.uncheckedProducts,
    fetcher,
  ]);

  useEffect(() => {
    const observedStatus = progressFetcher.data?.status;
    if (observedStatus === "completed" || (observedStatus === "failed" && !retryRequested)) return;
    const shouldPoll =
      observedStatus === "scanning" ||
      (retryRequested && fetcher.data?.success) ||
      (!observedStatus &&
        (settings?.initialScanStatus === "scanning" || fetcher.data?.success));
    if (!shouldPoll) return;
    loadAuditProgress("/api/catalog-audit-status");
    const timer = window.setInterval(
      () => loadAuditProgress("/api/catalog-audit-status"),
      7000,
    );
    return () => window.clearInterval(timer);
  }, [
    settings?.initialScanStatus,
    progressFetcher.data?.status,
    fetcher.data?.success,
    retryRequested,
    loadAuditProgress,
  ]);

  const observedScanStatus = progressFetcher.data?.status || settings?.initialScanStatus;
  const scanStatus = retryRequested && fetcher.data?.success && observedScanStatus !== "completed"
    ? "scanning"
    : observedScanStatus;
  useEffect(() => {
    if (retryRequested && (progressFetcher.data?.status === "scanning" || progressFetcher.data?.status === "completed" || (fetcher.state === "idle" && fetcher.data && !fetcher.data.success))) {
      setRetryRequested(false);
    }
  }, [retryRequested, progressFetcher.data?.status, fetcher.state, fetcher.data]);
  useEffect(() => {
    if (scanStatus !== "completed") {
      refreshedAfterAudit.current = false;
      return;
    }
    if (
      !refreshedAfterAudit.current &&
      settings?.initialScanStatus === "scanning"
    ) {
      refreshedAfterAudit.current = true;
      revalidator.revalidate();
    }
  }, [scanStatus, settings?.initialScanStatus, revalidator]);

  const isScanning =
    isSubmitting || fetcher.state !== "idle" || scanStatus === "scanning";

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
  const auditProgress = progressFetcher.data;
  const auditIsChecking = auditProgress?.phase === "monitor";
  const auditTotal = auditIsChecking ? auditProgress.productsImported : 0;
  const auditChecked = Math.min(auditProgress?.productsScanned || 0, auditTotal);

  return (
    <s-page size="large" className="page-shell" suppressHydrationWarning>
      <s-heading slot="title" size="large" suppressHydrationWarning>
        {t("dashboard.title")}
      </s-heading>

      <div className="admin-stack">
        <AdminCard className="admin-card admin-stack catalog-overview">
          <p className="catalog-overview__purpose">
            <Trans
              i18nKey="catalogOverview.purpose"
              components={{
                portalLink: <a
                  href="https://ec.europa.eu/safety-gate-alerts/screen/home"
                  target="_blank"
                  rel="noopener noreferrer"
                />,
              }}
            />
          </p>
          <dl className="catalog-overview__facts">
            <div>
              <dt>{t("catalogOverview.lastCheck")}</dt>
              <dd>
                {lastCatalogCheckAt ? (
                  <LocalDateTime
                    value={lastCatalogCheckAt}
                    format={(date) => new Intl.DateTimeFormat(i18n.language === "en" ? "en-GB" : i18n.language, {
                      dateStyle: "medium",
                      timeStyle: "short",
                    }).format(date)}
                  />
                ) : t("catalogOverview.noCompletedCheck")}
              </dd>
              {lastCatalogCheckAt && (
                <dd className="catalog-overview__detail">{t(lastCheckWasAudit ? "catalogOverview.initialAudit" : "catalogOverview.monitoringRun")}</dd>
              )}
            </div>
            <div>
              <dt>{t("catalogOverview.currentProducts")}</dt>
              <dd>{t("catalogOverview.coverage", { checked: stats.checkedProducts, total: stats.totalProducts })}</dd>
              {stats.uncheckedProducts > 0 && dashboardState !== "coverage-incomplete" && (
                <dd className="catalog-overview__detail">
                  <s-link href={remainingCatalogHref}>
                    {t("workspace.viewRemainingProducts", { count: stats.uncheckedProducts })}
                  </s-link>
                </dd>
              )}
            </div>
            <div>
              <dt>{t("workspace.monitoringLabel")}</dt>
              <dd>
                <s-badge tone={automaticStatus === "enabled" ? "success" : automaticStatus === "processing" ? "info" : "warning"}>
                  {t(`catalogOverview.monitoring.${automaticStatus}`)}
                </s-badge>
              </dd>
              {dashboardState !== "monitoring-problem" && automaticStatus !== "enabled" && (
                <dd className="catalog-overview__detail">{t(`catalogOverview.monitoringHelp.${automaticStatus}`)}</dd>
              )}
              {dashboardState !== "monitoring-problem" && monitoringActionHref && (
                <dd className="catalog-overview__detail">
                  <s-link href={monitoringActionHref} target={pricingPlansUrl ? "_top" : undefined}>
                    {monitoringActionLabel}
                  </s-link>
                </dd>
              )}
              {dashboardState !== "monitoring-problem" && monitoringNeedsRefresh && (
                <dd className="catalog-overview__detail">
                  <s-button
                    variant="tertiary"
                    loading={revalidator.state !== "idle"}
                    onClick={() => revalidator.revalidate()}
                  >
                    {t("catalogOverview.refreshStatus")}
                  </s-button>
                </dd>
              )}
            </div>
          </dl>
        </AdminCard>
        {/* Live Scan Progress Card when scan is active */}
        {isScanning && (
          <section className="live-scan-card" aria-live="polite">
            <div className="live-scan-header">
              <div>
                <p
                  className="admin-eyebrow"
                  style={{ margin: 0, color: "#008060" }}
                >
                  {t("dashboard.liveScan.eyebrow")}
                </p>
                <h3
                  style={{
                    margin: "4px 0 0",
                    fontSize: "18px",
                    fontWeight: 600,
                  }}
                >
                  {t("dashboard.liveScan.heading")}
                </h3>
              </div>
              <span className="live-scan-badge">
                <s-spinner size="small" />
                {t("dashboard.liveScan.inProgress")}
              </span>
            </div>
            <p
              style={{
                margin: "6px 0 0",
                fontSize: "13px",
                color: "var(--text-subdued)",
                maxWidth: "75ch",
              }}
            >
              {t("dashboard.liveScan.description")}
            </p>
            {auditProgress?.runStatus === "retrying" ? (
              <div className="live-scan-retry" role="status">
                <strong>{t("dashboard.liveScan.retryingHeading", { defaultValue: "The audit encountered a problem" })}</strong>
                <span>{t("dashboard.liveScan.retrying", { defaultValue: "The check hit a problem and will retry. Completed work is retained." })}</span>
              </div>
            ) : null}
            <div className="live-scan-progress">
              <div className="live-scan-progress-heading">
                <span>{auditIsChecking
                  ? t("dashboard.liveScan.checkingLabel", { defaultValue: "Products checked" })
                  : t("dashboard.liveScan.importingLabel", { defaultValue: "Products imported" })}</span>
                <strong>{auditIsChecking
                  ? `${auditChecked} / ${auditTotal}`
                  : (auditProgress?.productsImported || 0)}</strong>
              </div>
              {auditIsChecking && auditTotal > 0 ? (
                <progress className="live-scan-progress-bar" value={auditChecked} max={auditTotal}
                  aria-label={t("dashboard.liveScan.checkingLabel", { defaultValue: "Products checked" })} />
              ) : (
                <progress className="live-scan-progress-bar" aria-label={t("dashboard.liveScan.importingLabel", { defaultValue: "Products imported" })} />
              )}
              <p className="live-scan-progress-note">
                {auditIsChecking
                    ? t("dashboard.liveScan.checkingNote", { defaultValue: "Checking the imported catalog against Safety Gate. Progress updates as batches finish." })
                    : t("dashboard.liveScan.importingNote", { defaultValue: "Importing products from Shopify. The total will be known when import finishes." })}
              </p>
            </div>
            <div className="live-scan-steps">
              <div
                className={`live-scan-step ${progressFetcher.data?.phase === "monitor" ? "live-scan-step--done" : "live-scan-step--active"}`}
              >
                <span className="live-scan-step-icon">
                  {progressFetcher.data?.phase === "monitor" ? (
                    "✓"
                  ) : (
                    <s-spinner size="small" />
                  )}
                </span>
                <span>{t("dashboard.liveScan.stepImport")}</span>
              </div>
              <div
                className={`live-scan-step ${progressFetcher.data?.phase === "monitor" ? "live-scan-step--active" : ""}`}
              >
                <span className="live-scan-step-icon">
                  {progressFetcher.data?.phase === "monitor" ? (
                    <s-spinner size="small" />
                  ) : (
                    "2"
                  )}
                </span>
                <span>{t("dashboard.liveScan.stepScan")}</span>
              </div>
              <div className="live-scan-step">
                <span className="live-scan-step-icon live-scan-step-icon--pending">
                  3
                </span>
                <span style={{ color: "var(--text-subdued)" }}>
                  {t("dashboard.liveScan.stepAudit")}
                </span>
              </div>
            </div>
          </section>
        )}

        {!isScanning ? (
          <>
            <s-banner tone={summary.tone} heading={summary.title}>
              <s-stack gap="small">
                <s-text>{summary.description}</s-text>
                {summary.actionHref && (
                  <div>
                    <s-button
                      variant="primary"
                      href={summary.actionHref}
                      target={dashboardState === "monitoring-problem" && pricingPlansUrl ? "_top" : undefined}
                    >
                      {summary.actionLabel}
                    </s-button>
                  </div>
                )}
                {dashboardState === "monitoring-problem" && monitoringNeedsRefresh && (
                  <div>
                    <s-button variant="primary" loading={revalidator.state !== "idle"} onClick={() => revalidator.revalidate()}>
                      {t("catalogOverview.refreshStatus")}
                    </s-button>
                  </div>
                )}
              </s-stack>
            </s-banner>
            {scanStatus === "failed" && (
              <s-banner
                tone="warning"
                heading={t("dashboard.liveScan.failedHeading")}
              >
                <s-text>{t("dashboard.liveScan.failedDescription")}</s-text>
                <div style={{ marginTop: "var(--s-space-200)" }}>
                  <s-button
                    variant="secondary"
                    onClick={() => {
                      setRetryRequested(true);
                      fetcher.submit({ action: "importCatalogAndMonitor" }, { method: "POST" });
                    }}
                  >
                    {t("actions.retry")}
                  </s-button>
                </div>
              </s-banner>
            )}
            <s-stack direction="inline" gap="base" wrap>
              <s-link href="/app/audit-report">{t("workspace.reportTitle")}</s-link>
              {stats.waitingForSupplier > 0 && (
                <s-link href="/app/alerts?status=waiting_for_supplier">
                  {t("workspace.waiting")} ({stats.waitingForSupplier})
                </s-link>
              )}
            </s-stack>

            {recentMonitoringRuns.length > 0 && (
              <details className="catalog-overview__run-history">
                <summary>{t("dashboard.admin.monitoringRunHistoryTitle")}</summary>
                <div
                  className="monitoring-run-list"
                  aria-label={t("dashboard.admin.monitoringRunHistoryTitle")}
                >
                  {recentMonitoringRuns.map((run) => {
                    const statusKey = [
                      "queued",
                      "processing",
                      "retrying",
                      "completed",
                      "failed",
                      "enqueue_failed",
                      "skipped_unentitled",
                    ].includes(run.status)
                      ? run.status
                      : "unknown";
                    const tone =
                      run.status === "completed"
                        ? "success"
                        : run.status === "failed" ||
                            run.status === "enqueue_failed"
                          ? "critical"
                          : run.status === "skipped_unentitled"
                            ? "warning"
                            : "info";
                    return (
                      <div className="monitoring-run-list__row" key={run.id}>
                        <div className="monitoring-run-list__summary">
                          <s-badge tone={tone}>
                            {t(
                              `dashboard.admin.monitoringRunStatus.${statusKey}`,
                            )}
                          </s-badge>
                          <span>
                            {t("workspace.runScope", {
                              products: run.productsScanned,
                              records: run.rapexAlertsScanned,
                              findings: run.alertsCreated,
                            })}
                          </span>
                        </div>
                        <small>
                          {run.updatedAt ? (
                            <LocalDateTime
                              value={run.updatedAt}
                              format={(date) =>
                                formatRelativeDate(date, t, i18n.language)
                              }
                            />
                          ) : (
                            t("dashboard.admin.monitoringRunDateUnknown")
                          )}
                        </small>
                      </div>
                    );
                  })}
                </div>
              </details>
            )}
          </>
        ) : null}
      </div>
    </s-page>
  );
}
