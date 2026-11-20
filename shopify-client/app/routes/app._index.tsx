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
import { plannedMonitoringAt } from "../services/monitoring-schedule";
import { NextMonitoringCheck } from "../components/MonitoringStatus";
import { getMonitoringActivity, getRecentMonitoringRuns } from "../services/monitoring-runs.server";
import { recentlyCheckedProductCount, toIsoString } from "../services/monitoring-runs";
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

type DashboardProduct = { id: string; title: string; updatedAt: string | null };
const pendingPreviewLimit = 8;
const reviewPreviewLimit = 3;

async function fetchCurrentCatalogProducts(admin: any): Promise<DashboardProduct[]> {
  const products: DashboardProduct[] = [];
  let after: string | null = null;
  let hasNextPage = true;
  while (hasNextPage) {
    const response: { json: () => Promise<any> } = await admin.graphql(
      `#graphql
      query dashboardCatalogProducts($first: Int!, $after: String) {
        products(first: $first, after: $after) {
          pageInfo { hasNextPage endCursor }
          nodes { id title updatedAt }
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
      title: string;
      updatedAt?: string | null;
    }>;
    products.push(
      ...nodes.map((product) => ({
        id: product.id.replace("gid://shopify/Product/", ""),
        title: product.title,
        updatedAt: product.updatedAt || null,
      })),
    );
    hasNextPage = Boolean(connection?.pageInfo?.hasNextPage);
    after = connection?.pageInfo?.endCursor || null;
    if (hasNextPage && !after)
      throw new Error("Shopify catalog page did not include its next cursor");
  }
  return products;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { billing, session, admin } = await authenticate.admin(request);
  const billingStatus = await getBillingStatus(billing, session.shop, admin);

  const [
    recentAlerts,
    checkedProductIds,
    storedSettings,
    currentCatalogProducts,
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
    fetchCurrentCatalogProducts(admin),
  ]);

  const pendingReview = recentAlerts.filter(alert => !isWaitingForSupplier(alert));
  pendingReview.sort(compareReviewPriority);
  const monitorStateSnapshot = await firestore
    .collection("merchants")
    .doc(encodeURIComponent(session.shop))
    .get();
  const monitorState = monitorStateSnapshot.exists
    ? monitorStateSnapshot.data()
    : null;
  const observedAt = Date.now();
  const lastAuditAt = toIsoString(monitorState?.initialScanCompletedAt);
  const hasMonitoringBaseline = Boolean(toIsoString(monitorState?.monitoringBaselineAt));
  const auditRunId = monitorState?.initialScanRunId;
  const auditRunPromise = lastAuditAt && typeof auditRunId === "string" && auditRunId && !auditRunId.includes("/")
    ? monitorStateSnapshot.ref.collection("initial_catalog_runs").doc(auditRunId).get().catch(() => null)
    : null;
  const [recentMonitoringRuns, monitoringActivity, auditRun] = await Promise.all([
    getRecentMonitoringRuns(session.shop).catch((error) => {
      console.error("Could not load recent Safety Gate monitoring runs", { shop: session.shop, error });
      return [];
    }),
    getMonitoringActivity(session.shop, observedAt, lastAuditAt).catch((error) => {
      console.error("Could not load Safety Gate monitoring activity", { shop: session.shop, error });
      return null;
    }),
    auditRunPromise,
  ]);
  const auditCheckedProducts = auditRun?.get("productsScanned");
  const auditImportedProducts = auditRun?.get("productsImported");
  const firstAudit = auditRun?.get("status") === "completed" &&
    Number.isSafeInteger(auditCheckedProducts) && auditCheckedProducts > 0 &&
    Number.isSafeInteger(auditImportedProducts) && auditCheckedProducts === auditImportedProducts
    ? { checked: auditCheckedProducts as number, noNewMatches: auditRun.get("alertsCreated") === 0 }
    : null;

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
      },
      create: {
        shop: session.shop,
        onboardingCompleted: false,
        similarityThreshold: 70,
        autoDraftHighRisk: false,
        emailNotifications: true,
        notificationEmail: shopifyEmail,
        notificationEmailSource: "shopify",
      },
    });
  }

  const totalProductsCount = currentCatalogProducts.length;
  const productStates = catalogCheckStates(currentCatalogProducts, checkedProductIds);
  const pendingProducts = currentCatalogProducts
    .filter(product => productStates[product.id].state !== "current")
    .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));

  const lastMonitoringAt =
    recentMonitoringRuns.find((run) => run.status === "completed" && run.hasMore !== true && run.updatedAt)
      ?.updatedAt ||
    (monitorState?.lastMonitorStatus === "SUCCESS"
      ? toIsoString(monitorState.lastMonitorRunEnd)
      : null);
  const lastCatalogCheckAt = lastAuditAt && (!lastMonitoringAt || lastAuditAt > lastMonitoringAt)
    ? lastAuditAt : lastMonitoringAt;
  const newSourceRecords = lastCatalogCheckAt
    ? await firestore.collection("rapex_alerts")
        .where("meta.ingested_at", ">", new Date(lastCatalogCheckAt))
        .where("meta.ingested_at", "<=", new Date(observedAt))
        .count().get()
        .then(snapshot => snapshot.data().count)
        .catch(error => {
          console.warn("Could not count newly imported Safety Gate records", error);
          return null;
        })
    : null;
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
      checkedProducts: totalProductsCount - pendingProducts.length,
      uncheckedProducts: pendingProducts.length,
    },
    pendingProductPreview: pendingProducts.slice(0, pendingPreviewLimit).map(({ id, title }) => ({
      id,
      title,
      changed: productStates[id].state === "changed",
    })),
    reviewPreview: pendingReview.slice(0, reviewPreviewLimit).map((alert) => ({
      id: String(alert.id),
      productTitle: String(alert.productTitle || ""),
    })),
    settings: resolvedSettings,
    billingStatus,
    recentMonitoringRuns,
    observedAt,
    monitoringActivity,
    recentCheckedProducts: recentlyCheckedProductCount(checkedProductIds, observedAt, lastAuditAt),
    alertEmailEnabled: Boolean(
      (resolvedSettings.immediateAlertEmails ?? resolvedSettings.emailNotifications) &&
      resolvedSettings.notificationEmail?.trim(),
    ),
    lastMonitorStatus: monitorState?.lastMonitorStatus || null,
    lastMonitoringAt,
    lastAuditAt,
    newSourceRecords,
    hasMonitoringBaseline,
    firstAudit,
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
  const { t } = useTranslation();


  return (
    <s-page suppressHydrationWarning heading={t("nav.dashboard")}>

      <div className="admin-stack" style={{ marginTop: "var(--s-space-400)" }}>
        <s-banner tone="critical" heading={t("errors.pageLoadFailed")}>
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
    pendingProductPreview,
    reviewPreview,
    settings,
    billingStatus,
    lastMonitoringAt,
    lastAuditAt,
    newSourceRecords,
    hasMonitoringBaseline,
    firstAudit,
    lastMonitorStatus,
    recentMonitoringRuns,
    observedAt,
    monitoringActivity,
    recentCheckedProducts,
    alertEmailEnabled,
  } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<ActionResponse>();
  const progressFetcher = useFetcher<CatalogAuditProgress>();
  const navigation = useNavigation();
  const revalidator = useRevalidator();
  const shopify = useAppBridge();
  const { t, i18n } = useTranslation();

  const isLoading = navigation.state === "loading";
  const isSubmitting = fetcher.state === "submitting";
  const waitingFindingsHref = "/app/alerts?status=waiting_for_supplier";
  const remainingCatalogHref = "/app/manual-check?coverage=remaining#product-catalogue";
  const latestMonitoringStatus = recentMonitoringRuns[0]?.status === "completed"
    ? lastMonitorStatus
    : recentMonitoringRuns[0]?.status || lastMonitorStatus;
  const automaticStatus = monitoringState(
    billingStatus, latestMonitoringStatus, observedAt, lastMonitoringAt, lastAuditAt,
  );
  const lastCheckWasAudit = Boolean(lastAuditAt && (!lastMonitoringAt || lastAuditAt > lastMonitoringAt));
  const lastCatalogCheckAt = lastCheckWasAudit ? lastAuditAt : lastMonitoringAt;
  const nextAutomaticCheckAt = plannedMonitoringAt(hasMonitoringBaseline, automaticStatus, observedAt);
  const monitoringNeedsRefresh = automaticStatus === "unknown" || automaticStatus === "unverified";
  const pricingPlansUrl = automaticStatus === "paused" ? billingStatus.pricingPlansUrl : null;
  const number = new Intl.NumberFormat(i18n.language);
  const canRetryAudit = Boolean(billingStatus.ownerTestAccess || billingStatus.developmentBypass ||
    (billingStatus.billingVerified && (billingStatus.hasActivePayment || !settings.freeScanUsed)));
  const automaticChecksExpected = ["enabled", "processing", "starting"].includes(automaticStatus);
  const monitoringActionHref =
    automaticChecksExpected || monitoringNeedsRefresh
      ? null
      : pricingPlansUrl || "/app/settings";
  const monitoringActionLabel = t(pricingPlansUrl ? "billingRedirect.openPricingPlans" : "settings.title");
  const dashboardState =
    stats.activeAlerts > 0
      ? "review-needed"
      : ["paused", "unverified"].includes(automaticStatus)
        ? "monitoring-problem"
        : stats.totalProducts === 0
          ? "empty"
          : stats.uncheckedProducts > 0
            ? "coverage-incomplete"
            : !automaticChecksExpected
              ? "monitoring-problem"
              : stats.waitingForSupplier > 0
                ? "waiting-for-supplier"
                : automaticStatus === "starting" || automaticStatus === "processing"
                  ? "monitoring-pending"
                  : "no-action-needed";
  const summary = {
    "coverage-incomplete": {
      tone: "warning",
      title: t("pendingCoverage.title", { count: stats.uncheckedProducts }),
      description: null,
      actionHref: "#pending-catalog-products",
      actionLabel: t("pendingCoverage.pendingTab"),
    },
    "monitoring-pending": {
      tone: "warning",
      title: t(`catalogOverview.monitoring.${automaticStatus}`),
      description: null,
      actionHref: null,
      actionLabel: "",
    },
    "review-needed": {
      tone: "critical",
      title: t("dashboard.admin.status.reviewNeeded.title", { count: stats.activeAlerts }),
      description: null,
      actionHref: stats.activeAlerts > reviewPreview.length ? "/app/alerts?status=active" : null,
      actionLabel: t("alerts.title"),
    },
    "monitoring-problem": {
      tone: automaticStatus === "processing" ? "info" : "warning",
      title: t(`catalogOverview.monitoring.${automaticStatus}`),
      description: t(`catalogOverview.monitoringHelp.${automaticStatus}`),
      actionHref: monitoringActionHref,
      actionLabel: monitoringActionLabel,
    },
    "waiting-for-supplier": {
      tone: "warning",
      title: `${t("workspace.waiting")} (${number.format(stats.waitingForSupplier)})`,
      description: null,
      actionHref: waitingFindingsHref,
      actionLabel: t("alerts.title"),
    },
    "no-action-needed": {
      tone: "success",
      title: t("dashboard.admin.status.noActionNeeded.title"),
      description: t("catalogOverview.noActionHelp"),
      showScopeNote: true,
      actionHref: null,
      actionLabel: "",
    },
    empty: {
      tone: "info",
      title: t("dashboard.admin.status.noActionNeeded.emptyCatalogTitle"),
      description: t("dashboard.admin.status.noActionNeeded.emptyCatalogDescription"),
      actionHref: "shopify:admin/products",
      actionLabel: t("pendingCoverage.viewAll"),
    },
  }[dashboardState];
  const hasAutoStartedScan = useRef(false);
  const refreshedAfterAudit = useRef(false);
  const [retryRequested, setRetryRequested] = useState(false);
  const loadAuditProgress = progressFetcher.load;
  const startsFirstAudit = stats.totalProducts > 0 && stats.uncheckedProducts > 0 &&
    canRetryAudit && !settings.initialScanStatus && !fetcher.data;
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
        (billingStatus.hasActivePayment || !settings?.freeScanUsed),
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
    startsFirstAudit || isSubmitting || fetcher.state !== "idle" || scanStatus === "scanning";

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
  const showFirstAuditResult = scanStatus === "completed" && lastCheckWasAudit &&
    firstAudit && stats.activeAlerts === 0;
  const firstAuditClear = stats.uncheckedProducts === 0 && stats.waitingForSupplier === 0;
  const firstAuditIsSummary = showFirstAuditResult &&
    (dashboardState === "no-action-needed" || dashboardState === "monitoring-pending");

  const purpose = (
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
  );

  return (
    <s-page inlineSize="large" className="page-shell" suppressHydrationWarning heading={t("dashboard.title")}>


      <div className="admin-stack">
        {!isScanning && showFirstAuditResult && firstAudit && (
          <s-banner
            tone={firstAuditIsSummary ? summary.tone : "info"}
            heading={firstAuditIsSummary && dashboardState === "monitoring-pending" ? summary.title : t("catalogOverview.firstResultTitle")}
          >
            <s-stack direction="inline" gap="small" alignItems="center" wrap>
              {firstAuditIsSummary && dashboardState === "monitoring-pending" && (
                <s-text>{t("catalogOverview.firstResultTitle")}</s-text>
              )}
              <s-text>
                {t("catalogOverview.currentProducts")} · <strong>{number.format(firstAudit.checked)}</strong>
              </s-text>
              {firstAudit.noNewMatches && <s-badge tone="neutral">{t("workspace.noMatch")}</s-badge>}
              {firstAuditClear && <s-badge tone="neutral">{t("dashboard.admin.status.noActionNeeded.title")}</s-badge>}
              <s-link href="/app/manual-check#product-catalogue">{t("nav.catalogCoverage")}</s-link>
            </s-stack>
          </s-banner>
        )}
        {!isScanning && summary && (scanStatus !== "failed" || stats.activeAlerts > 0) &&
          !firstAuditIsSummary && (
          <s-banner tone={summary.tone} heading={summary.title}>
            <s-stack gap="small">
              {summary.description && <s-text>{summary.description}</s-text>}
              {dashboardState === "review-needed" && reviewPreview.length > 0 && (
                <ul className="dashboard-review-list">
                  {reviewPreview.map((finding) => (
                    <li key={finding.id}>
                      <s-link href={`/app/alerts?status=active&open=${encodeURIComponent(finding.id)}`}>
                        {finding.productTitle || t("common.unknown")}
                      </s-link>
                    </li>
                  ))}
                </ul>
              )}
              {"showScopeNote" in summary && <s-text>{t("catalogOverview.resultBoundary")}</s-text>}
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
        )}
        {!isScanning && scanStatus === "failed" && (
          <s-banner tone="warning" heading={t("dashboard.liveScan.failedHeading")}>
            <s-stack gap="small">
              <s-text>{t("dashboard.liveScan.failedDescription")}</s-text>
              <div>
                {canRetryAudit ? (
                  <s-button
                    variant="primary"
                    onClick={() => {
                      setRetryRequested(true);
                      fetcher.submit({ action: "importCatalogAndMonitor" }, { method: "POST" });
                    }}
                  >
                    {t("actions.retry")}
                  </s-button>
                ) : pricingPlansUrl ? (
                  <s-button variant="primary" href={pricingPlansUrl} target="_top">
                    {t("billingRedirect.openPricingPlans")}
                  </s-button>
                ) : monitoringNeedsRefresh && (
                  <s-button variant="secondary" loading={revalidator.state !== "idle"} onClick={() => revalidator.revalidate()}>
                    {t("catalogOverview.refreshStatus")}
                  </s-button>
                )}
              </div>
            </s-stack>
          </s-banner>
        )}
        {/* Live Scan Progress Card when scan is active */}
        {isScanning && (
          <section className="live-scan-card" aria-live="polite">
            <div className="live-scan-header">
              <div>
                <h3
                  style={{
                    margin: 0,
                    fontSize: "18px",
                    fontWeight: 600,
                  }}
                >
                  {t("catalogOverview.auditTitle")}
                </h3>
              </div>
              <span className="live-scan-badge">
                <s-spinner size="small" />
                {t("dashboard.liveScan.inProgress")}
              </span>
            </div>
            {purpose}
            <p
              style={{
                margin: "6px 0 0",
                fontSize: "13px",
                color: "var(--text-subdued)",
                maxWidth: "75ch",
              }}
            >
              {t("catalogOverview.auditBackground")}
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
                <span>{t("dashboard.liveScan.importingLabel")}</span>
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
                <span>{t("dashboard.liveScan.checkingLabel")}</span>
              </div>
            </div>
          </section>
        )}

        {!isScanning && (
          <AdminCard className="admin-card admin-stack catalog-overview">
            <div>
              <div className="catalog-monitoring__heading">
                <h2 className="admin-card__title">{t("workspace.monitoringLabel")}</h2>
                <s-badge tone={automaticStatus === "enabled" ? "success" : automaticChecksExpected ? "info" : "warning"}>
                  {t(automaticStatus === "processing" && (latestMonitoringStatus === "queued" || latestMonitoringStatus === "retrying")
                    ? `dashboard.admin.monitoringRunStatus.${latestMonitoringStatus}`
                    : `catalogOverview.monitoring.${automaticStatus}`)}
                </s-badge>
              </div>
              {automaticChecksExpected ? purpose : (
                <p className="catalog-overview__purpose">{t(`catalogOverview.monitoringHelp.${automaticStatus}`)}</p>
              )}
              {lastAuditAt && !showFirstAuditResult && (
                <div className="catalog-monitoring__schedule">
                  <s-badge tone="neutral">{t("catalogOverview.firstResultTitle")}</s-badge>
                </div>
              )}
              {dashboardState !== "monitoring-problem" && monitoringActionHref && (
                <s-link href={monitoringActionHref} target={pricingPlansUrl ? "_top" : undefined}>
                  {monitoringActionLabel}
                </s-link>
              )}
              {dashboardState !== "monitoring-problem" && monitoringNeedsRefresh && scanStatus !== "failed" && (
                <s-button variant="tertiary" loading={revalidator.state !== "idle"} onClick={() => revalidator.revalidate()}>
                  {t("catalogOverview.refreshStatus")}
                </s-button>
              )}
            </div>

            <div className="catalog-monitoring__metrics">
              <dl className="catalog-overview__facts">
                <div>
                  <dt>{t("catalogOverview.lastCheck")}</dt>
                  <dd className={lastCatalogCheckAt ? "catalog-overview__last-check" : undefined}>
                    {lastCatalogCheckAt ? (
                      <LocalDateTime
                        value={lastCatalogCheckAt}
                        locale={i18n.language}
                        format={(date) => new Intl.DateTimeFormat(i18n.language === "en" ? "en-GB" : i18n.language, {
                          day: "numeric",
                          month: "numeric",
                          year: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        }).format(date)}
                      />
                    ) : t("catalogOverview.noCompletedCheck")}
                  </dd>
                  {nextAutomaticCheckAt && (
                    <dd className="catalog-overview__detail"><NextMonitoringCheck value={nextAutomaticCheckAt} /></dd>
                  )}
                  {lastCatalogCheckAt && (
                    <dd className="catalog-overview__detail">
                      {t("catalogOverview.recordsSinceCheck")} <strong>{newSourceRecords === null ? "—" : number.format(newSourceRecords)}</strong>
                    </dd>
                  )}
                </div>
                <div>
                  <dt>{t("catalogOverview.currentProducts")}</dt>
                  <dd>{t("catalogOverview.coverage", { checked: number.format(stats.checkedProducts), total: number.format(stats.totalProducts) })}</dd>
                  {stats.totalProducts > 0 && (
                    <dd className="catalog-overview__detail">
                      <s-link href={stats.uncheckedProducts > 0 ? "#pending-catalog-products" : "/app/manual-check?coverage=all#product-catalogue"}>
                        {stats.uncheckedProducts > 0
                          ? `${t("pendingCoverage.pendingTab")} (${number.format(stats.uncheckedProducts)})`
                          : t("nav.catalogCoverage")}
                      </s-link>
                    </dd>
                  )}
                </div>
              </dl>

              {(monitoringActivity || recentCheckedProducts !== null) && (
                <>
                  <h3 className="catalog-monitoring__period">{t("catalogOverview.activityTitle")}</h3>
                  <dl className="catalog-overview__facts catalog-monitoring__activity">
                    {monitoringActivity && (
                      <div>
                        <dt>{t("catalogOverview.activityRuns")}</dt>
                        <dd>{number.format(monitoringActivity.completedRuns)}</dd>
                      </div>
                    )}
                    {recentCheckedProducts !== null && (
                      <div>
                        <dt>{t("catalogOverview.currentProducts")}</dt>
                        <dd>{number.format(recentCheckedProducts)}</dd>
                      </div>
                    )}
                    <div>
                      <dt>{t("catalogOverview.activityRecords")}</dt>
                      <dd>{monitoringActivity?.recordsConsidered != null
                        ? number.format(monitoringActivity.recordsConsidered)
                        : "—"}</dd>
                    </div>
                  </dl>
                </>
              )}
            </div>

            {(automaticChecksExpected || (billingStatus.pricingPlansUrl && !pricingPlansUrl)) && (
              <div className="catalog-monitoring__links">
                {automaticChecksExpected && (
                  <div>
                    <s-link href="/app/settings">{t("settingsAdmin.notifications.enabledTitle")}</s-link>
                    <s-badge tone={alertEmailEnabled ? "info" : "neutral"}>
                      {t(alertEmailEnabled ? "settingsOverview.on" : "settingsOverview.off")}
                    </s-badge>
                  </div>
                )}
                {billingStatus.pricingPlansUrl && !pricingPlansUrl && (
                  <s-link href="/app/settings#subscription">{t("billing.managePlanButton")}</s-link>
                )}
              </div>
            )}
          </AdminCard>
        )}

        {!isScanning && pendingProductPreview.length > 0 && (
          <div id="pending-catalog-products">
            <s-section heading={t("pendingCoverage.title", { count: stats.uncheckedProducts })}>
              <s-stack gap="small">
                <s-table>
                  <s-table-header-row>
                    <s-table-header listSlot="primary">{t("manualCheck.catalogue.columns.product")}</s-table-header>
                    <s-table-header listSlot="inline">{t("catalogUx.checkStatus")}</s-table-header>
                  </s-table-header-row>
                  <s-table-body>
                    {pendingProductPreview.map(product => (
                      <s-table-row key={product.id}>
                        <s-table-cell><s-link href={`shopify:admin/products/${product.id}`}>{product.title}</s-link></s-table-cell>
                        <s-table-cell>
                          <s-badge tone="warning">
                            {t(product.changed ? "workspace.changed" : "manualCheck.catalogue.status.notChecked")}
                          </s-badge>
                        </s-table-cell>
                      </s-table-row>
                    ))}
                  </s-table-body>
                </s-table>
                <s-link href={remainingCatalogHref}>{t("nav.catalogCoverage")}</s-link>
              </s-stack>
            </s-section>
          </div>
        )}
        {!isScanning ? (
          <>
            <s-stack direction="inline" gap="base" wrap>
              <s-link href="/app/audit-report">{t("workspace.reportTitle")}</s-link>
              {stats.waitingForSupplier > 0 && dashboardState !== "waiting-for-supplier" && (
                <s-link href={waitingFindingsHref}>
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
