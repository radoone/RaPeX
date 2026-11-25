import { useHydrated } from "../components/LocalDateTime";
import { normalizeInterfaceLanguage, preferredInterfaceLanguage } from "../services/interface-language";
import { Suspense, useEffect, useRef, useState } from "react";
import { randomUUID } from "node:crypto";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  Await,
  Link,
  useFetcher,
  useLoaderData,
  useRevalidator,
} from "react-router";
import { data as json } from "react-router";
import { Trans, useTranslation } from "react-i18next";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import db, { safetySettingFromSnapshot, type SafetySettingRecord } from "../merchant-db.server";
import { firestore } from "../firestore.server";
import { AlertBadge } from "../components/AlertBadge";
import { compareReviewPriority } from "../services/review-priority";
import { isWaitingForSupplier, parseEvidence } from "../services/review-evidence";
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
import { monitoringTimeZone, plannedMonitoringAt } from "../services/monitoring-schedule";
import { NextMonitoringCheck } from "../components/MonitoringStatus";
import { getMonitoringActivity, getRecentMonitoringRuns, recordManualMonitoringRun } from "../services/monitoring-runs.server";
import { recentlyCheckedProductCount, toIsoString } from "../services/monitoring-runs";
import { mirrorOfflineSessionForCatalogAudit } from "../services/catalog-audit-session.server";
import { getShopifyNotificationEmail } from "../services/shopify-notification-email.server";

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

type DashboardContext = Awaited<ReturnType<typeof authenticate.admin>>;
type DashboardChecks = Promise<Parameters<typeof catalogCheckStates>[1]>;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const context = await authenticate.admin(request);
  const shopifyLocale = normalizeInterfaceLanguage(new URL(request.url).searchParams.get("locale"));
  const merchant = firestore.collection("merchants").doc(encodeURIComponent(context.session.shop)).get();
  const summary = loadOverviewSummary(context.session.shop, merchant);
  const billingStatus = getBillingStatus(context.billing, context.session.shop, context.admin);
  let checkedProducts: DashboardChecks | undefined;
  const loadCheckedProducts = () => checkedProducts ??= db.safetyCheck.findMany({
    where: { shop: context.session.shop },
    orderBy: { checkedAt: "desc" },
    select: { productId: true, checkedAt: true, sourceUpdatedAt: true },
  });
  const catalog = loadOverviewCatalog(context.admin, loadCheckedProducts());

  return {
    shopifyLocale,
    summary,
    access: Promise.all([
      billingStatus,
      summary.then(({ settings }) => initializeOverviewSettings(context, settings)),
    ]).then(([resolvedBillingStatus, initializedSettings]) => ({
      billingStatus: resolvedBillingStatus,
      settings: initializedSettings,
    })),
    catalog,
    history: summary.then(data => loadOverviewHistory(context.session.shop, merchant, loadCheckedProducts(), data)),
    reviewProducts: summary.then(({ reviewPreview }) => loadOverviewReviewProducts(context.admin, reviewPreview)),
  };
};

async function loadOverviewSummary(
  shop: string,
  merchant: Promise<FirebaseFirestore.DocumentSnapshot>,
) {
  const [recentAlerts, monitorStateSnapshot, recentMonitoringRuns] = await Promise.all([
    db.safetyAlert.findMany({
      where: { shop, status: "active" },
      select: { id: true, productId: true, productTitle: true, status: true, reviewState: true,
        resolutionType: true, riskLevel: true, createdAt: true, checkResult: true },
    }),
    merchant,
    getRecentMonitoringRuns(shop).catch(error => {
      console.error("Could not load recent Safety Gate monitoring runs", { shop, error });
      return [];
    }),
  ]);
  const settings = safetySettingFromSnapshot(shop, monitorStateSnapshot);
  const pendingReview = recentAlerts.filter(alert => !isWaitingForSupplier(alert));
  pendingReview.sort(compareReviewPriority);
  const monitorState = monitorStateSnapshot.data();
  const observedAt = Date.now();
  const lastAuditAt = toIsoString(monitorState?.initialScanCompletedAt);
  const hasMonitoringBaseline = Boolean(toIsoString(monitorState?.monitoringBaselineAt));
  const lastSavedRun = recentMonitoringRuns.find(run =>
    run.status === "completed" && run.hasMore !== true && run.updatedAt,
  );
  const lastSavedRunAt = lastSavedRun?.updatedAt ?? null;
  const lastCheckpointAt = monitorState?.lastMonitorStatus === "SUCCESS"
    ? toIsoString(monitorState.lastMonitorRunEnd)
    : null;
  const checkpointIsNewer = lastCheckpointAt && (!lastSavedRunAt || lastCheckpointAt > lastSavedRunAt);
  const lastMonitoringAt = checkpointIsNewer ? lastCheckpointAt : lastSavedRunAt;
  const lastCatalogCheckAt = lastAuditAt && (!lastMonitoringAt || lastAuditAt > lastMonitoringAt)
    ? lastAuditAt : lastMonitoringAt;

  return {
    findingStats: {
      activeAlerts: pendingReview.length,
      waitingForSupplier: recentAlerts.length - pendingReview.length,
    },
    reviewPreview: pendingReview.slice(0, reviewPreviewLimit).map(alert => {
      const evidence = parseEvidence(alert.checkResult);
      return {
        id: String(alert.id),
        productId: String(alert.productId || "").replace("gid://shopify/Product/", ""),
        productTitle: String(alert.productTitle || ""),
        caseNumber: evidence.caseNumber,
        sourceUrl: evidence.url,
        riskLevel: evidence.riskLevel,
        similarity: typeof evidence.overallSimilarity === "number" ? evidence.overallSimilarity : null,
        matchBasis: evidence.matchBasis,
      };
    }),
    settings,
    lastMonitorStatus: monitorState?.lastMonitorStatus || null,
    recentMonitoringRuns,
    observedAt,
    lastMonitoringAt,
    lastAuditAt,
    lastCatalogCheckAt,
    hasMonitoringBaseline,
  };
}

async function initializeOverviewSettings({ session, admin }: DashboardContext, storedSettings: SafetySettingRecord | null) {
  let settings = storedSettings;
  const shopifyEmail = !settings?.notificationEmail?.trim() && settings?.notificationEmailSource !== "custom"
    ? await getShopifyNotificationEmail(admin)
    : null;
  if (!settings || settings.emailNotifications === undefined || shopifyEmail) {
    const initialized = await db.safetySetting.upsert({
      where: { shop: session.shop },
      update: {
        ...(settings?.emailNotifications === undefined
          ? { emailNotifications: true }
          : {}),
        ...(shopifyEmail
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
    settings = await db.safetySetting.findUnique({ where: { shop: session.shop } }) ?? initialized;
  }

  return settings;
}

async function loadOverviewCatalog(admin: DashboardContext["admin"], checkedProducts: DashboardChecks) {
  const [currentCatalogProducts, checkedProductIds] = await Promise.all([
    fetchCurrentCatalogProducts(admin),
    checkedProducts,
  ]);
  const totalProductsCount = currentCatalogProducts.length;
  const productStates = catalogCheckStates(currentCatalogProducts, checkedProductIds);
  const pendingProducts = currentCatalogProducts
    .filter(product => productStates[product.id].state !== "current")
    .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));

  return {
    totalProducts: totalProductsCount,
    checkedProducts: totalProductsCount - pendingProducts.length,
    uncheckedProducts: pendingProducts.length,
    pendingProductPreview: pendingProducts.slice(0, pendingPreviewLimit).map(({ id, title }) => ({
      id,
      title,
      changed: productStates[id].state === "changed",
    })),
  };
}

async function loadOverviewHistory(
  shop: string,
  merchant: Promise<FirebaseFirestore.DocumentSnapshot>,
  checkedProducts: DashboardChecks,
  { lastAuditAt, lastCatalogCheckAt, observedAt }: Awaited<ReturnType<typeof loadOverviewSummary>>,
) {
  const monitorStateSnapshot = await merchant;
  const auditRunId = monitorStateSnapshot.get("initialScanRunId");
  const auditRunPromise = lastAuditAt && typeof auditRunId === "string" && auditRunId && !auditRunId.includes("/")
    ? monitorStateSnapshot.ref.collection("initial_catalog_runs").doc(auditRunId).get().catch(() => null)
    : null;
  const [monitoringActivity, auditRun, newSourceRecords, checkedProductIds] = await Promise.all([
    getMonitoringActivity(shop, observedAt, lastAuditAt).catch((error) => {
      console.error("Could not load Safety Gate monitoring activity", { shop, error });
      return null;
    }),
    auditRunPromise,
    lastCatalogCheckAt ? firestore.collection("rapex_alerts")
      .where("meta.ingested_at", ">", new Date(lastCatalogCheckAt))
      .where("meta.ingested_at", "<=", new Date(observedAt))
      .count().get()
      .then(snapshot => snapshot.data().count)
      .catch(error => {
        console.warn("Could not count newly imported Safety Gate records", error);
        return null;
      }) : null,
    checkedProducts,
  ]);
  const auditCheckedProducts = auditRun?.get("productsScanned");
  const auditImportedProducts = auditRun?.get("productsImported");
  const firstAudit = auditRun?.get("status") === "completed" &&
    Number.isSafeInteger(auditCheckedProducts) && auditCheckedProducts > 0 &&
    Number.isSafeInteger(auditImportedProducts) && auditCheckedProducts === auditImportedProducts
    ? { checked: auditCheckedProducts as number, noNewMatches: auditRun.get("alertsCreated") === 0 }
    : null;

  return {
    monitoringActivity,
    newSourceRecords,
    firstAudit,
    recentCheckedProducts: recentlyCheckedProductCount(checkedProductIds, observedAt, lastAuditAt),
  };
}

async function loadOverviewReviewProducts(
  admin: DashboardContext["admin"],
  preview: Awaited<ReturnType<typeof loadOverviewSummary>>["reviewPreview"],
) {
  const previewProductIds = [...new Set(preview.map(alert => alert.productId).filter(id => /^\d+$/.test(id)))];
  const previewProducts = new Map<string, { image: string | null; sku: string | null }>();
  if (previewProductIds.length) {
    try {
      const response = await admin.graphql(
        `#graphql
        query dashboardReviewProducts($ids: [ID!]!) {
          nodes(ids: $ids) {
            ... on Product {
              id
              featuredImage { url }
              variants(first: 2) { nodes { sku } }
            }
          }
        }`,
        { variables: { ids: previewProductIds.map(id => `gid://shopify/Product/${id}`) } },
      );
      const payload = await response.json();
      for (const product of payload.data?.nodes ?? []) {
        if (!product?.id) continue;
        const variants = product.variants?.nodes;
        previewProducts.set(product.id, {
          image: product.featuredImage?.url ?? null,
          sku: variants?.length === 1 ? variants[0]?.sku || null : null,
        });
      }
    } catch (error) {
      console.warn("Could not load dashboard finding products", error);
    }
  }
  return Object.fromEntries(previewProducts);
}

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
      const merchant = await firestore.collection("merchants").doc(encodeURIComponent(session.shop)).get().catch(error => {
        console.warn("Could not read merchant before recording manual monitoring", error);
        return null;
      });
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

      if (merchant?.exists) {
        await recordManualMonitoringRun(merchant, monitoring).catch(error => {
          console.warn("Could not record completed manual monitoring in scan history", error);
        });
      }

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
  const { summary, shopifyLocale, ...sections } = useLoaderData<typeof loader>();
  const { t } = useTranslation();
  return (
    <Suspense fallback={
      <s-page inlineSize="large" heading={t("redesign.overview", { lng: shopifyLocale })} className="overview-page" suppressHydrationWarning>
        <div className="overview-layout">
          <p className="catalog-overview__purpose" role="status">{t("loadingOverview", { lng: shopifyLocale })}</p>
          <div aria-hidden="true" className="overview-loading">
            <div className="overview-metrics">
              {[0, 1, 2].map(index => (
                <div key={index} className="overview-metric overview-loading__metric">
                  <div className="overview-loading__lines">
                    <span />
                    <span />
                  </div>
                </div>
              ))}
            </div>
            <section className="overview-monitor overview-monitor--loading">
              <div className="overview-loading__lines">
                <span />
                <span />
              </div>
            </section>
            <section className="overview-findings">
              <div className="overview-loading__lines">
                <span />
              </div>
              <div className="overview-loading__rows">
                {[0, 1, 2].map(index => (
                  <div key={index} className="overview-loading__row">
                    <span className="overview-loading__thumb" />
                    <div className="overview-loading__lines">
                      <span />
                      <span />
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </div>
      </s-page>
    }>
      <Await resolve={summary}>
        {(data: Awaited<ReturnType<typeof loadOverviewSummary>>) => (
          <Overview data={data} sections={sections} shopifyLocale={shopifyLocale} />
        )}
      </Await>
    </Suspense>
  );
}

// Keep the summary mounted while the independent streams resolve or revalidate.
function useOverviewSection<T>(promise: Promise<T>) {
  const [result, setResult] = useState<{ promise: Promise<T>; value: T | null }>();
  useEffect(() => {
    let current = true;
    void promise.then(
      value => { if (current) setResult({ promise, value }); },
      () => { if (current) setResult({ promise, value: null }); },
    );
    return () => { current = false; };
  }, [promise]);
  return result?.promise === promise ? result.value : undefined;
}

type OverviewSections = Omit<Awaited<ReturnType<typeof loader>>, "summary" | "shopifyLocale">;

function Overview({ data, sections, shopifyLocale }: {
  data: Awaited<ReturnType<typeof loadOverviewSummary>>;
  sections: OverviewSections;
  shopifyLocale?: string;
}) {
  const {
    findingStats,
    reviewPreview,
    lastMonitoringAt,
    lastAuditAt,
    lastCatalogCheckAt,
    hasMonitoringBaseline,
    lastMonitorStatus,
    recentMonitoringRuns,
    observedAt,
  } = data;
  const catalog = useOverviewSection(sections.catalog);
  const history = useOverviewSection(sections.history);
  const access = useOverviewSection(sections.access);
  const reviewProducts = useOverviewSection(sections.reviewProducts);
  const settings = access?.settings ?? data.settings;
  const billingStatus = access?.billingStatus;
  const stats = {
    ...findingStats,
    totalProducts: catalog?.totalProducts ?? 0,
    checkedProducts: catalog?.checkedProducts ?? 0,
    uncheckedProducts: catalog?.uncheckedProducts ?? 0,
  };
  const pendingProductPreview = catalog?.pendingProductPreview ?? [];
  const firstAudit = history?.firstAudit;
  const alertEmailEnabled = Boolean(
    (settings?.immediateAlertEmails ?? settings?.emailNotifications) && settings?.notificationEmail?.trim(),
  );
  const fetcher = useFetcher<ActionResponse>();
  const monitoringFetcher = useFetcher<ActionResponse>();
  const progressFetcher = useFetcher<CatalogAuditProgress>();
  const revalidator = useRevalidator();
  const shopify = useAppBridge();
  const hydrated = useHydrated();
  const language = hydrated ? preferredInterfaceLanguage(shopifyLocale) : shopifyLocale || "en";
  const { t } = useTranslation(undefined, { lng: language });
  const isSubmitting = fetcher.state === "submitting";
  const waitingFindingsHref = "/app/alerts?status=waiting_for_supplier";
  const remainingCatalogHref = "/app/manual-check?coverage=remaining#product-catalogue";
  const latestMonitoringStatus = recentMonitoringRuns[0]?.status === "completed"
    ? lastMonitorStatus
    : recentMonitoringRuns[0]?.status || lastMonitorStatus;
  const automaticStatus = billingStatus
    ? monitoringState(billingStatus, latestMonitoringStatus, observedAt, lastMonitoringAt, lastAuditAt)
    : null;
  const lastCheckWasAudit = Boolean(lastAuditAt && (!lastMonitoringAt || lastAuditAt > lastMonitoringAt));
  const nextAutomaticCheckAt = automaticStatus && plannedMonitoringAt(hasMonitoringBaseline, automaticStatus, observedAt);
  const monitoringNeedsRefresh = access === null || automaticStatus === "unknown" || automaticStatus === "unverified";
  const pricingPlansUrl = automaticStatus === "paused" ? billingStatus?.pricingPlansUrl : null;
  const number = new Intl.NumberFormat(language);
  const scanDateFormat = new Intl.DateTimeFormat(language, {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: monitoringTimeZone,
  });
  const canRetryAudit = Boolean(billingStatus && (
    billingStatus.ownerTestAccess || billingStatus.developmentBypass ||
    (billingStatus.billingVerified && (billingStatus.hasActivePayment || !settings?.freeScanUsed))
  ));
  const automaticChecksExpected = automaticStatus === "enabled" || automaticStatus === "processing" || automaticStatus === "starting";
  const monitoringActionHref =
    automaticChecksExpected || monitoringNeedsRefresh
      ? null
      : pricingPlansUrl || "/app/settings";
  const monitoringActionLabel = t(pricingPlansUrl ? "billingRedirect.openPricingPlans" : "settings.title");
  const dashboardState =
    stats.activeAlerts > 0
      ? "review-needed"
      : automaticStatus === "paused" || automaticStatus === "unverified"
        ? "monitoring-problem"
        : !catalog || !automaticStatus
          ? null
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
  const summary = dashboardState && {
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
      actionHref: null,
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
    canRetryAudit && !settings?.initialScanStatus && !fetcher.data;
  useEffect(() => {
    // Start first-run protection without asking the merchant to discover a
    // secondary dashboard action. Paid stores may retry an interrupted first
    // import; free stores retain their one-scan billing limit.
    const completedWithoutChecks =
      settings?.initialScanStatus === "completed" &&
      stats.totalProducts > 0 &&
      stats.checkedProducts === 0;
    const isScanNeeded =
      stats.totalProducts > 0 &&
      stats.uncheckedProducts > 0 &&
      canRetryAudit &&
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
    canRetryAudit,
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

  useEffect(() => {
    const result = monitoringFetcher.data;
    if (monitoringFetcher.state !== "idle" || !result) return;
    if (result.success && result.message) shopify.toast.show(result.message);
    if (!result.success) shopify.toast.show(t("errors.apiError"), { isError: true });
  }, [monitoringFetcher.data, monitoringFetcher.state, shopify, t]);

  const auditProgress = progressFetcher.data;
  const auditIsChecking = auditProgress?.phase === "monitor";
  const auditTotal = auditIsChecking ? auditProgress.productsImported : 0;
  const auditChecked = Math.min(auditProgress?.productsScanned || 0, auditTotal);
  const showFirstAuditResult = catalog && scanStatus === "completed" && lastCheckWasAudit &&
    firstAudit && stats.activeAlerts === 0;
  const firstAuditClear = stats.uncheckedProducts === 0 && stats.waitingForSupplier === 0;
  const firstAuditIsSummary = showFirstAuditResult &&
    (dashboardState === "no-action-needed" || dashboardState === "monitoring-pending");

  const purpose = (
    <p className="catalog-overview__purpose">
      <Trans
        t={t}
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

  const monitorStatusText = t(automaticStatus === "processing" &&
    (latestMonitoringStatus === "queued" || latestMonitoringStatus === "retrying")
    ? `dashboard.admin.monitoringRunStatus.${latestMonitoringStatus}`
    : `catalogOverview.monitoring.${automaticStatus}`);
  const monitoringActive = automaticStatus === "enabled";
  const mayCheckManually = Boolean(billingStatus && (
    (billingStatus.hasActivePayment && billingStatus.billingVerified) ||
    billingStatus.ownerTestAccess || billingStatus.developmentBypass
  ));
  const runCheckAvailable = hasMonitoringBaseline && mayCheckManually;

  return (
    <s-page inlineSize="large" heading={t("redesign.overview")} className="overview-page" suppressHydrationWarning>
      {access !== undefined && (runCheckAvailable ? (
        <s-button
          slot="primary-action"
          variant="primary"
          icon="play"
          disabled={isScanning || automaticStatus === "processing" || monitoringFetcher.state !== "idle"}
          loading={monitoringFetcher.state !== "idle"}
          onClick={() => monitoringFetcher.submit({ action: "bulkCheck", monitoringMode: "since-last-check" }, { method: "POST" })}
        >
          {t("redesign.runDelta")}
        </s-button>
      ) : mayCheckManually ? (
        <s-button slot="primary-action" variant="primary" icon="search" href="/app/manual-check">
          {t("actions.checkOneProduct")}
        </s-button>
      ) : null)}
      <div className="overview-layout">
        <div className="overview-header__title">
          {purpose}
          {monitoringActive && !isScanning && <s-badge tone="success">{t("settingsOverview.active")}</s-badge>}
        </div>

        <div className="overview-metrics">
          <div className="overview-metric">
            <s-icon type="product" aria-hidden="true" />
            <div>
              {catalog ? (
                <div className="overview-metric-value">{number.format(stats.checkedProducts)}</div>
              ) : catalog === null ? (
                <div className="overview-metric-value">—</div>
              ) : (
                <div className="overview-loading__lines" role="status" aria-label={t("loadingOverview")}><span /></div>
              )}
              <div>{t("redesign.productsScanned")}</div>
            </div>
          </div>
          <div className="overview-metric">
            <s-icon type="alert-triangle" tone={stats.activeAlerts ? "warning" : "neutral"} aria-hidden="true" />
            <div>
              <div className="overview-metric-value">{number.format(stats.activeAlerts)}</div>
              <div>{t("redesign.potentialMatches")}</div>
            </div>
          </div>
          <div className="overview-metric">
            <s-icon type="calendar" aria-hidden="true" />
            <div>
              <div className="overview-metric-value">
                {lastCatalogCheckAt ? (
                  <time dateTime={lastCatalogCheckAt} title={lastCatalogCheckAt}>
                    {scanDateFormat.format(new Date(lastCatalogCheckAt))}
                  </time>
                ) : "—"}
              </div>
              <div>{t("redesign.lastScan")}</div>
            </div>
          </div>
        </div>

        {!isScanning && access === undefined && (
          <section className="overview-monitor overview-monitor--loading" role="status" aria-label={t("loadingOverview")}>
            <div className="overview-loading__lines">
              <span />
              <span />
            </div>
          </section>
        )}
        {!isScanning && automaticStatus && (
          <section className="overview-monitor" data-status={monitoringActive ? "active" : automaticChecksExpected ? "pending" : "warning"}>
            <s-icon
              type={monitoringActive ? "check-circle" : automaticChecksExpected ? "clock" : "alert-circle"}
              tone={monitoringActive ? "success" : automaticChecksExpected ? "info" : "warning"}
              aria-hidden="true"
            />
            <div className="overview-monitor__copy">
              <h2>{monitoringActive ? t("dashboard.admin.monitoringStatusAllClear") : monitorStatusText}</h2>
              {monitoringActive ? (
                nextAutomaticCheckAt && <p><NextMonitoringCheck value={nextAutomaticCheckAt} /></p>
              ) : (
                <p>{t(`catalogOverview.monitoringHelp.${automaticStatus}`, { defaultValue: "" })}</p>
              )}
            </div>
            <div className="overview-actions">
              {monitoringNeedsRefresh && (
                <s-button variant="secondary" loading={revalidator.state !== "idle"} onClick={() => revalidator.revalidate()}>
                  {t("catalogOverview.refreshStatus")}
                </s-button>
              )}
              {pricingPlansUrl && <s-button variant="secondary" href={pricingPlansUrl} target="_top">{monitoringActionLabel}</s-button>}
              <s-button variant="secondary" href="/app/settings">{t("settings.title")}</s-button>
            </div>
          </section>
        )}
        {!isScanning && (catalog === null || history === null || access === null) && (
          <s-banner tone="warning" heading={t("errors.pageLoadFailed")}>
            <s-button loading={revalidator.state !== "idle"} onClick={() => revalidator.revalidate()}>
              {t("actions.retry")}
            </s-button>
          </s-banner>
        )}
        {!isScanning && (
          <s-section>
            <details className="overview-activity">
              <summary>{t("catalogOverview.activityTitle")}</summary>
              {history === undefined && (
                <div className="overview-loading__facts" role="status" aria-label={t("loadingOverview")}>
                  {[0, 1, 2].map(index => (
                    <div key={index} className="overview-loading__lines">
                      <span />
                      <span />
                    </div>
                  ))}
                </div>
              )}
              {history && (
                <>
                  <dl className="catalog-overview__facts">
                    <div>
                      <dt>{t("nav.catalogCoverage")}</dt>
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
                    {lastCatalogCheckAt && (
                      <div>
                        <dt>{t("catalogOverview.recordsSinceCheck")}</dt>
                        <dd>{history.newSourceRecords == null ? "—" : number.format(history.newSourceRecords)}</dd>
                      </div>
                    )}
                    {history.monitoringActivity && (
                      <div>
                        <dt>{t("catalogOverview.activityRuns")}</dt>
                        <dd>{number.format(history.monitoringActivity.completedRuns)}</dd>
                      </div>
                    )}
                    {history.recentCheckedProducts !== null && (
                      <div>
                        <dt>{t("catalogOverview.currentProducts")}</dt>
                        <dd>{number.format(history.recentCheckedProducts)}</dd>
                      </div>
                    )}
                    {history.monitoringActivity && (
                      <div>
                        <dt>{t("catalogOverview.activityRecords")}</dt>
                        <dd>{history.monitoringActivity.recordsConsidered == null ? "—" : number.format(history.monitoringActivity.recordsConsidered)}</dd>
                      </div>
                    )}
                  </dl>
                  <div className="overview-activity__links">
                    <s-link href="/app/settings">{t("settingsAdmin.notifications.enabledTitle")}</s-link>
                    <s-badge tone={alertEmailEnabled ? "info" : "neutral"}>{t(alertEmailEnabled ? "settingsOverview.on" : "settingsOverview.off")}</s-badge>
                    {billingStatus?.pricingPlansUrl && <s-link href="/app/settings#subscription">{t("billing.managePlanButton")}</s-link>}
                  </div>
                </>
              )}
            </details>
          </s-section>
        )}

        {!isScanning && showFirstAuditResult && firstAudit && summary && (
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
        {!isScanning && dashboardState !== "review-needed" && summary && (scanStatus !== "failed" || stats.activeAlerts > 0) &&
          !firstAuditIsSummary && (
          <s-banner tone={summary.tone} heading={summary.title}>
            <s-stack gap="small">
              {summary.description && <s-text>{summary.description}</s-text>}
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

        <section className="overview-findings" aria-labelledby="overview-findings-heading">
          <header className="overview-findings__header">
            <div>
              <h2 id="overview-findings-heading">{t("redesign.potentialMatches")}</h2>
              <p>{t("catalogOverview.reviewHelp")}</p>
            </div>
            <Link className="overview-inline-link" to="/app/alerts?view=all">
              {t("redesign.viewAllMatches")} <s-icon type="arrow-right" size="small" aria-hidden="true" />
            </Link>
          </header>
          {reviewPreview.length > 0 ? (
            <div className="overview-findings__table">
              <s-table accessibilityLabel={t("redesign.potentialMatches")}>
                <s-table-header-row>
                  <s-table-header listSlot="primary">{t("alerts.table.headers.product")}</s-table-header>
                  <s-table-header listSlot="labeled">{t("redesign.aiSimilarity")}</s-table-header>
                  <s-table-header listSlot="labeled">{t("findingOverview.officialRisk")}</s-table-header>
                  <s-table-header listSlot="labeled">{t("redesign.safetyGateReference")}</s-table-header>
                  <s-table-header listSlot="inline">{t("alerts.table.headers.status")}</s-table-header>
                  <s-table-header>{t("alerts.table.headers.actions")}</s-table-header>
                </s-table-header-row>
                <s-table-body>
                  {reviewPreview.map(finding => {
                    const href = `/app/alerts?status=active&open=${encodeURIComponent(finding.id)}`;
                    const product = reviewProducts?.[`gid://shopify/Product/${finding.productId}`];
                    return (
                      <s-table-row key={finding.id}>
                        <s-table-cell>
                          <div className="overview-finding-product">
                            {reviewProducts === undefined ? (
                              <span className="overview-loading__thumb" aria-hidden="true" />
                            ) : (
                              <s-thumbnail src={product?.image || undefined} alt="" size="base" />
                            )}
                            <div>
                              <Link to={href}>{finding.productTitle || t("common.unknown")}</Link>
                              {product?.sku && <div className="overview-finding-product__sku">SKU: {product.sku}</div>}
                            </div>
                          </div>
                        </s-table-cell>
                        <s-table-cell>
                          {finding.matchBasis === "gtin" ? <s-badge tone="info">{t("barcodeMatch.label")}</s-badge>
                            : finding.similarity == null ? "—" : (
                              <s-badge tone="neutral">
                                {t("redesign.percent", { value: finding.similarity })}
                              </s-badge>
                            )}
                        </s-table-cell>
                        <s-table-cell><AlertBadge alertLevel={String(finding.riskLevel || "")} showSeverity /></s-table-cell>
                        <s-table-cell>
                          {finding.caseNumber && finding.sourceUrl ? (
                            <a className="overview-inline-link" href={finding.sourceUrl} target="_blank" rel="noreferrer">
                              {finding.caseNumber}<s-icon type="external" size="small" aria-hidden="true" />
                            </a>
                          ) : finding.caseNumber || "—"}
                        </s-table-cell>
                        <s-table-cell><s-badge tone="warning">{t("status.needsReview")}</s-badge></s-table-cell>
                        <s-table-cell><s-button href={href} variant="secondary">{t("redesign.review")}</s-button></s-table-cell>
                      </s-table-row>
                    );
                  })}
                </s-table-body>
              </s-table>
            </div>
          ) : <p className="overview-findings__empty">{t("alerts.table.emptyAllClearTitle")}</p>}
        </section>

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

          </>
        ) : null}
      </div>
    </s-page>
  );
}
