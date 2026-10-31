import { AdminCard } from "../components/AdminCard";
import { LocalDateTime } from "../components/LocalDateTime";
import { useState, useCallback, useEffect, useMemo } from "react";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import {
  useLoaderData,
  useFetcher,
  useNavigate,
  useRouteError,
} from "react-router";
import { data as json } from "react-router";
import { useTranslation } from "react-i18next";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { shopifyProductToProductData } from "../services/safety-gate-product-data";
import db from "../merchant-db.server";
import { withOfficialReferences } from "../services/review-evidence.server";
import { firestore } from "../firestore.server";
import { runProductSafetyCheck } from "../services/product-safety-admin.server";
import { runMerchantDeltaMonitoring } from "../services/safety-gate-checker.server";
import { AlertDetailModal, SummaryCard } from "../components";
import {
  type ResolutionType,
  formatRelativeDate,
} from "../components/AlertTable";
import {
  getBillingStatus,
  requireActiveBilling,
} from "../services/billing.server";
import { catalogCheckStates } from "../services/catalog-state";

type ShopifyCatalogProduct = {
  id: string;
  title: string;
  handle?: string;
  updatedAt?: string;
  [key: string]: unknown;
};

type CatalogCachePlan = {
  products: ShopifyCatalogProduct[];
  productsToCheck: ShopifyCatalogProduct[];
  cachedUnchanged: number;
  totalFetched: number;
};

function merchantProductDocRef(shop: string, productId: string) {
  return firestore
    .collection("merchants")
    .doc(encodeURIComponent(shop))
    .collection("products")
    .doc(encodeURIComponent(productId));
}

async function fetchCatalogProductsForManualCheck(
  admin: any,
  limit = 300,
  query: string | null = null,
): Promise<ShopifyCatalogProduct[]> {
  const products: ShopifyCatalogProduct[] = [];
  let after: string | null = null;
  let hasNextPage = true;

  while (hasNextPage && products.length < limit) {
    const first = Math.min(100, limit - products.length);
    const response: { json: () => Promise<any> } = await admin.graphql(
      `#graphql
      query manualCheckCatalogProducts($first: Int!, $after: String, $query: String) {
        products(first: $first, after: $after, sortKey: UPDATED_AT, reverse: true, query: $query) {
          pageInfo {
            hasNextPage
            endCursor
          }
          edges {
            node {
              id
              title
              handle
              status
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
    `,
      { variables: { first, after, query } },
    );

    const jsonResponse: any = await response.json();
    if (jsonResponse.errors?.length || !jsonResponse.data?.products)
      throw new Error("Could not load Shopify catalog");
    const connection: any = jsonResponse.data.products;
    const edges = connection?.edges || [];
    products.push(...edges.map((edge: any) => edge.node));
    hasNextPage =
      Boolean(connection?.pageInfo?.hasNextPage) && products.length < limit;
    after = connection?.pageInfo?.endCursor || null;
    if (hasNextPage && !after)
      throw new Error("Shopify catalog cursor is missing");
  }

  return products;
}

async function planCatalogChecksForManualCheck(params: {
  admin: any;
  shop: string;
  limit?: number;
}): Promise<CatalogCachePlan> {
  const products = await fetchCatalogProductsForManualCheck(
    params.admin,
    params.limit ?? 300,
  );
  const refs = products.map((product) => {
    const productId = product.id.replace("gid://shopify/Product/", "");
    return merchantProductDocRef(params.shop, productId);
  });
  const snapshots = refs.length > 0 ? await firestore.getAll(...refs) : [];
  const productsToCheck: ShopifyCatalogProduct[] = [];
  let cachedUnchanged = 0;

  products.forEach((product, index) => {
    const cached = snapshots[index];
    const cachedData = cached?.exists ? cached.data() : null;
    const cachedSourceUpdatedAt =
      typeof cachedData?.sourceUpdatedAt === "string"
        ? cachedData.sourceUpdatedAt.trim()
        : "";
    const incomingSourceUpdatedAt =
      typeof product.updatedAt === "string" ? product.updatedAt.trim() : "";
    const hasCachedVectors = Boolean(
      cachedData?.vector_text || cachedData?.vector_image,
    );
    const unchanged = Boolean(
      cached?.exists &&
      hasCachedVectors &&
      cachedSourceUpdatedAt &&
      incomingSourceUpdatedAt &&
      cachedSourceUpdatedAt === incomingSourceUpdatedAt,
    );

    if (unchanged) {
      cachedUnchanged += 1;
      return;
    }

    productsToCheck.push(product);
  });

  return {
    products,
    productsToCheck,
    cachedUnchanged,
    totalFetched: products.length,
  };
}

export const loader = async ({ request, url }: LoaderFunctionArgs) => {
  const { admin, billing, session } = await authenticate.admin(request);
  const billingStatus = await getBillingStatus(billing, session.shop, admin);
  const search = url.searchParams.get("search")?.trim() || "";

  const coverageCatalogProducts = await fetchCatalogProductsForManualCheck(
    admin,
    Infinity,
  );
  const totalProducts = coverageCatalogProducts.length;
  const products = search
    ? await fetchCatalogProductsForManualCheck(admin, Infinity, search)
    : coverageCatalogProducts;

  const productIds = products.map((p: any) =>
    p.id.replace("gid://shopify/Product/", ""),
  );

  // Load safety checks
  const productChecks = await db.safetyCheck.findMany({
    where: { shop: session.shop, productId: { in: productIds } },
    orderBy: { checkedAt: "desc" },
  });
  const allProductChecks = await db.safetyCheck.findMany({
    where: { shop: session.shop },
    orderBy: { checkedAt: "desc" },
  });
  const monitorStateSnapshot = await firestore
    .collection("merchants")
    .doc(encodeURIComponent(session.shop))
    .get();
  const monitorState = monitorStateSnapshot.exists
    ? monitorStateSnapshot.data()
    : null;

  // Load existing alerts for products (same transformation as Alerts page)
  const rawAlerts = await withOfficialReferences(
    await db.safetyAlert.findMany({
      where: { shop: session.shop, productId: { in: productIds } },
      orderBy: { createdAt: "desc" },
    }),
  );

  // Transform alerts same as Alerts page
  const alertsByProduct: Record<string, any> = {};
  rawAlerts.forEach((alert: any) => {
    let alertType = "Unknown",
      riskDescription = "",
      alertDetails = null,
      riskLevelFromResult = null;
    try {
      const checkResult = JSON.parse(alert.checkResult);
      const warnings = Array.isArray(checkResult?.warnings)
        ? checkResult.warnings
        : [];
      if (warnings.length > 0) {
        const first = warnings[0];
        alertType =
          first.alertType ||
          first.alertDetails?.fields?.alert_type ||
          "Unknown";
        riskDescription =
          first.riskLegalProvision ||
          first.alertDetails?.fields?.risk_legal_provision ||
          "";
        alertDetails = first.alertDetails || null;
        riskLevelFromResult =
          first.alertDetails?.fields?.alert_level ||
          first.alertDetails?.fields?.risk_level ||
          first.riskLevel ||
          null;
      }
    } catch {
      // Ignore malformed legacy check payloads and fall back to stored alert fields.
    }
    const effectiveRiskLevel =
      riskLevelFromResult ||
      (alert.riskLevel !== "unknown" ? alert.riskLevel : null) ||
      "Unknown";

    // Get product image from products array
    const product = products.find(
      (p: any) =>
        p.id.replace("gid://shopify/Product/", "") === alert.productId,
    );

    const transformedAlert = {
      ...alert,
      alertType,
      riskDescription,
      alertDetails,
      riskLevel: effectiveRiskLevel,
      productImage:
        (product?.featuredImage as { url?: string } | undefined)?.url ||
        null,
    };

    // Store by productId - keep the most recent/active one
    if (
      !alertsByProduct[alert.productId] ||
      (alert.status === "active" &&
        alertsByProduct[alert.productId].status !== "active")
    ) {
      alertsByProduct[alert.productId] = transformedAlert;
    }
  });

  const checksByProduct = productChecks.reduce((acc: any, check: any) => {
    if (!acc[check.productId])
      acc[check.productId] = {
        checks: [],
        totalChecks: 0,
        lastCheck: null,
        isSafe: null,
        safeCount: 0,
        unsafeCount: 0,
      };
    acc[check.productId].checks.push(check);
    acc[check.productId].totalChecks++;
    if (
      !acc[check.productId].lastCheck ||
      check.checkedAt > acc[check.productId].lastCheck.checkedAt
    ) {
      acc[check.productId].lastCheck = check;
      acc[check.productId].isSafe = check.isSafe;
    }
    if (check.isSafe) {
      acc[check.productId].safeCount++;
    } else {
      acc[check.productId].unsafeCount++;
    }
    return acc;
  }, {});
  const productStates = catalogCheckStates(
    coverageCatalogProducts,
    allProductChecks,
  );
  const checkedProductCount = Object.values(productStates).filter(
    (item) => item.state === "current",
  ).length;
  const uncheckedProductCount = totalProducts - checkedProductCount;
  const coveragePercent = totalProducts
    ? Math.round((checkedProductCount / totalProducts) * 100)
    : 0;
  const latestCheck =
    [...allProductChecks].sort(
      (a: any, b: any) =>
        new Date(b.checkedAt).getTime() - new Date(a.checkedAt).getTime(),
    )[0] || null;
  const totalActiveAlerts = await db.safetyAlert.count({
    where: { shop: session.shop, status: "active" },
  });

  return json({
    products,
    checksByProduct,
    alertsByProduct,
    search,
    shop: session.shop,
    totalProducts,
    productStates,
    storeStats: {
      activeAlerts: totalActiveAlerts,
      totalChecks: allProductChecks.length,
    },
    coverage: {
      checkedProductCount,
      uncheckedProductCount,
      coveragePercent,
      isComplete:
        totalProducts > 0 &&
        checkedProductCount >= totalProducts &&
        monitorState?.lastMonitorStatus !== "FAILURE",
      monitoringStatus: monitorState?.lastMonitorStatus || null,
      monitoringLastRunAt: monitorState?.lastMonitorRunEnd || null,
      lastCheckedAt: latestCheck?.checkedAt || null,
      lastResultSafe:
        typeof latestCheck?.isSafe === "boolean" ? latestCheck.isSafe : null,

      totalChecks: allProductChecks.length,
    },
    billingStatus,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, billing, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const action = formData.get("action") as string;

  if (action === "checkProduct" || action === "checkAllProducts") {
    const billingRedirect = await requireActiveBilling(billing, session.shop, {
      admin,
    });
    if (billingRedirect) return billingRedirect as never;
  }

  const recordOwnedAlertDecision = async (
    alertId: string,
    decision: "resolve" | "dismiss" | "reactivate",
    resolutionType?: string | null,
    notes?: string | null,
  ) =>
    db.safetyAlert.recordDecisions({
      shop: session.shop,
      alertIds: [alertId],
      action: decision,
      actorId: session.id,
      resolutionType,
      notes,
    });

  if (action === "checkProduct") {
    const productData = JSON.parse(formData.get("productData") as string);
    const productId = formData.get("productId") as string;
    const productTitle = formData.get("productTitle") as string;

    try {
      const runResult = await runProductSafetyCheck({
        shop: session.shop,
        productId,
        productTitle,
        productHandle: (formData.get("productHandle") as string) || undefined,
        productData,
        sourceUpdatedAt:
          (formData.get("productUpdatedAt") as string) || undefined,
      });
      return json({
        success: true,
        result: runResult.result,
        alertCreated: runResult.alertCreated,
        alertId: runResult.alertId,
      });
    } catch (error) {
      return json({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  if (action === "checkAllProducts") {
    try {
      const checkPlan = await planCatalogChecksForManualCheck({
        admin,
        shop: session.shop,
        limit: 300,
      });
      let changedChecked = 0;
      let changedAlertsCreated = 0;
      let changedErrors = 0;

      for (const product of checkPlan.productsToCheck) {
        try {
          const result = await runProductSafetyCheck({
            shop: session.shop,
            productId: product.id.replace("gid://shopify/Product/", ""),
            productTitle: product.title,
            productHandle: product.handle,
            productData: shopifyProductToProductData(product),
            sourceUpdatedAt: product.updatedAt,
          });
          changedChecked += 1;
          if (result.alertCreated) {
            changedAlertsCreated += 1;
          }
        } catch (error) {
          changedErrors += 1;
          console.error("Manual cached catalog product check failed", {
            shop: session.shop,
            productId: product.id,
            error,
          });
        }
      }

      const monitoring = await runMerchantDeltaMonitoring(session.shop, {
        forceFullScan: false,
        limit: 300,
        monitoringMode: "since-last-check",
      });

      await db.activityLog.create({
        data: {
          shop: session.shop,
          type: "bulk",
          action: "check",
          details: `Manual cached catalog check skipped ${checkPlan.cachedUnchanged} unchanged products, checked ${changedChecked} new or changed products, and scanned ${monitoring.productsScanned} cached products against new Safety Gate alerts.`,
        },
      });

      return json({
        success: true,
        action: "checkAllProducts",
        message: `Checked ${changedChecked} new or changed products, skipped ${checkPlan.cachedUnchanged} unchanged cached products, and created ${changedAlertsCreated + monitoring.alertsCreated} review items`,
        results: {
          changedChecked,
          cachedSkipped: checkPlan.cachedUnchanged,
          deltaChecked: monitoring.productsScanned,
          errors: changedErrors,
          alertsCreated: changedAlertsCreated + monitoring.alertsCreated,
          totalProducts: checkPlan.totalFetched,
        },
      });
    } catch (error) {
      console.error("Manual full-catalog check failed:", error);
      return json(
        {
          success: false,
          error:
            error instanceof Error
              ? error.message
              : "Full catalog check failed",
        },
        { status: 500 },
      );
    }
  }

  // Handle resolve action
  if (action === "resolve") {
    const alertId = formData.get("alertId") as string;
    const resolutionType = formData.get("resolutionType") as string | null;
    const notes = formData.get("notes") as string | null;

    if (resolutionType === "other" && !notes?.trim()) {
      return json(
        { success: false, error: "A note is required for the other outcome" },
        { status: 400 },
      );
    }

    try {
      await recordOwnedAlertDecision(alertId, "resolve", resolutionType, notes);
      return json({ success: true, action: "resolved" });
    } catch (error) {
      return json({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  // Handle dismiss action
  if (action === "dismiss") {
    const alertId = formData.get("alertId") as string;
    const resolutionType = formData.get("resolutionType") as string | null;
    const notes = formData.get("notes") as string | null;

    if (resolutionType === "other" && !notes?.trim()) {
      return json(
        { success: false, error: "A note is required for the other outcome" },
        { status: 400 },
      );
    }

    try {
      await recordOwnedAlertDecision(alertId, "dismiss", resolutionType, notes);
      return json({ success: true, action: "dismissed" });
    } catch (error) {
      return json({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  // Handle reactivate action
  if (action === "reactivate") {
    const alertId = formData.get("alertId") as string;

    try {
      await recordOwnedAlertDecision(alertId, "reactivate");
      return json({ success: true, action: "reactivated" });
    } catch (error) {
      return json({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  return json({ success: false, error: "Invalid action" });
};

export function ErrorBoundary() {
  useRouteError();
  const { t } = useTranslation();

  return (
    <s-page suppressHydrationWarning>
      <s-heading slot="title" size="large" suppressHydrationWarning>
        {t("manualCheck.title")}
      </s-heading>
      <div className="admin-stack" style={{ marginTop: "var(--s-space-400)" }}>
        <s-banner tone="critical" heading={t("errors.pageLoadFailed")}>
          <s-text>{t("errors.apiError")}</s-text>
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

export default function ManualCheckPage() {
  const {
    products,
    checksByProduct,
    alertsByProduct,
    search,
    shop,
    totalProducts,
    coverage,
    productStates,
    storeStats,
  } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const resolveFetcher = useFetcher<typeof action>();
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();
  const shopify = useAppBridge();

  const [selectedProduct, setSelectedProduct] = useState<any>(null);
  const [checkResult, setCheckResult] = useState<any>(null);
  const [currentAlertId, setCurrentAlertId] = useState<string | null>(null);
  const [showResult, setShowResult] = useState(false);
  const [hasProcessedResult, setHasProcessedResult] = useState(false);
  const [searchValue, setSearchValue] = useState(search);
  const [visibleCount, setVisibleCount] = useState(50);
  const [tabFilter, setTabFilter] = useState<
    "all" | "unprotected" | "needs_review" | "safe"
  >("all");
  const [shopifyStatusFilter, setShopifyStatusFilter] = useState("all");
  const dateLocale = i18n.language === "sk" ? "sk-SK" : "en-GB";

  const filterCounts = useMemo(() => {
    let unprotected = 0;
    let needsReview = 0;
    let safe = 0;
    products.forEach((product: any) => {
      const productId = product.id.replace("gid://shopify/Product/", "");
      const existingAlert = alertsByProduct[productId];
      const hasActiveAlert = existingAlert?.status === "active";
      const isProtected = productStates[productId]?.state === "current";

      if (!isProtected) unprotected++;
      if (hasActiveAlert) needsReview++;
      if (
        isProtected &&
        productStates[productId]?.current?.isSafe &&
        !hasActiveAlert
      )
        safe++;
    });
    return { all: products.length, unprotected, needsReview, safe };
  }, [products, alertsByProduct, productStates]);

  const filteredProducts = useMemo(() => {
    return products.filter((product: any) => {
      if (shopifyStatusFilter !== "all" && product.status !== shopifyStatusFilter) return false;
      const productId = product.id.replace("gid://shopify/Product/", "");
      const existingAlert = alertsByProduct[productId];
      const hasActiveAlert = existingAlert?.status === "active";
      const isProtected = productStates[productId]?.state === "current";

      if (tabFilter === "unprotected") {
        return !isProtected;
      }
      if (tabFilter === "needs_review") {
        return hasActiveAlert;
      }
      if (tabFilter === "safe") {
        return Boolean(
          isProtected &&
          productStates[productId]?.current?.isSafe &&
          !hasActiveAlert,
        );
      }
      return true;
    });
  }, [products, alertsByProduct, productStates, tabFilter, shopifyStatusFilter]);

  // Synchronize searchValue with URL parameter when it changes (e.g., cleared/updated externally)
  useEffect(() => {
    setSearchValue(search);
  }, [search]);

  // Debounced search effect (400ms delay)
  useEffect(() => {
    const handler = setTimeout(() => {
      const trimmedSearch = searchValue.trim();
      const currentSearch = search.trim();
      if (trimmedSearch !== currentSearch) {
        const params = new URLSearchParams();
        if (trimmedSearch) params.set("search", trimmedSearch);
        const query = params.toString();
        navigate(query ? `/app/manual-check?${query}` : "/app/manual-check");
      }
    }, 400);

    return () => {
      clearTimeout(handler);
    };
  }, [searchValue, search, navigate]);

  // Get all alerts from alertsByProduct for modals
  const existingAlerts = (Object.values(alertsByProduct || {}) as any[]).filter(
    (alert) =>
      filteredProducts
        .slice(0, visibleCount)
        .some(
          (product: any) =>
            product.id.replace("gid://shopify/Product/", "") ===
            alert.productId,
        ),
  );

  const lastRunAt = coverage.lastCheckedAt;
  const lastRunResult =
    coverage.lastResultSafe === null
      ? t("manualCheck.coverage.noRunYet")
      : coverage.lastResultSafe
        ? t("workspace.noMatchAtCheck")
        : t("workspace.possibleMatchAtCheck");
  const applySearch = useCallback(() => {
    const params = new URLSearchParams();
    const value = searchValue.trim();
    if (value) params.set("search", value);
    const query = params.toString();
    navigate(query ? `/app/manual-check?${query}` : "/app/manual-check");
  }, [navigate, searchValue]);

  const handleProductCheck = useCallback(
    (product: any) => {
      const productData = shopifyProductToProductData(product);
      fetcher.submit(
        {
          action: "checkProduct",
          productData: JSON.stringify(productData),
          productId: product.id.replace("gid://shopify/Product/", ""),
          productTitle: product.title,
          productHandle: product.handle || "",
          productUpdatedAt: product.updatedAt || "",
        },
        { method: "POST" },
      );
      setSelectedProduct(product);
      setHasProcessedResult(false);
    },
    [fetcher],
  );

  const activeFetcherAction = fetcher.formData?.get("action");
  const isLoading = fetcher.state === "submitting";
  const isCheckingAllProducts =
    fetcher.state !== "idle" && activeFetcherAction === "checkAllProducts";
  const isCheckingOneProduct =
    fetcher.state !== "idle" && activeFetcherAction === "checkProduct";

  const handleCheckAllProducts = useCallback(() => {
    if (isLoading) return;
    fetcher.submit(
      {
        action: "checkAllProducts",
      },
      { method: "POST" },
    );
  }, [fetcher, isLoading]);

  useEffect(() => {
    if (
      fetcher.data &&
      "success" in fetcher.data &&
      fetcher.data.success &&
      "result" in fetcher.data &&
      !showResult &&
      !hasProcessedResult
    ) {
      setCheckResult((fetcher.data as any).result);
      setCurrentAlertId((fetcher.data as any).alertId || null);
      setShowResult(true);
      setHasProcessedResult(true);
    }
  }, [fetcher.data, showResult, hasProcessedResult]);

  useEffect(() => {
    if (
      !fetcher.data ||
      !("success" in fetcher.data) ||
      !fetcher.data.success
    ) {
      return;
    }

    if ("message" in fetcher.data && fetcher.data.message) {
      shopify.toast.show((fetcher.data as any).message);
      return;
    }

    if ("alertCreated" in fetcher.data && fetcher.data.alertCreated) {
      shopify.toast.show(t("manualCheck.toasts.flagged"));
      return;
    }

    shopify.toast.show(t("manualCheck.toasts.completed"));
  }, [fetcher.data, shopify, t]);

  // Handle resolve/dismiss completion - navigate to alerts if successful
  useEffect(() => {
    if (
      resolveFetcher.data &&
      "success" in resolveFetcher.data &&
      resolveFetcher.data.success
    ) {
      setShowResult(false);
      setCheckResult(null);
      setCurrentAlertId(null);
      setSelectedProduct(null);
      // Optionally navigate to alerts page to see the resolved alert
      // navigate('/app/alerts');
    }
  }, [resolveFetcher.data]);

  // Handle resolve action
  const handleResolve = useCallback(
    (alertId: string, resolutionType?: ResolutionType, notes?: string) => {
      resolveFetcher.submit(
        {
          action: "resolve",
          alertId,
          resolutionType: resolutionType || "",
          notes: notes || "",
        },
        { method: "POST" },
      );
    },
    [resolveFetcher],
  );

  // Handle dismiss action
  const handleDismiss = useCallback(
    (alertId: string, resolutionType?: ResolutionType, notes?: string) => {
      resolveFetcher.submit(
        {
          action: "dismiss",
          alertId,
          resolutionType: resolutionType || "",
          notes: notes || "",
        },
        { method: "POST" },
      );
    },
    [resolveFetcher],
  );

  // Handle reactivate action
  const handleReactivate = useCallback(
    (alertId: string) => {
      resolveFetcher.submit(
        {
          action: "reactivate",
          alertId,
        },
        { method: "POST" },
      );
    },
    [resolveFetcher],
  );

  // Auto-open modal when result is ready
  useEffect(() => {
    if (showResult && checkResult) {
      // Open the modal using Polaris Web showOverlay() method
      const modal = document.getElementById(
        "manual-check-result-modal",
      ) as HTMLElement & { showOverlay?: () => void };
      if (modal?.showOverlay) {
        modal.showOverlay();
      }
    }
  }, [showResult, checkResult]);

  return (
    <s-page size="large" className="page-shell" suppressHydrationWarning>
      <s-heading slot="title" size="large" suppressHydrationWarning>
        {t("manualCheck.title")}
      </s-heading>
      <s-button
        slot="primary-action"
        variant="primary"
        onClick={handleCheckAllProducts}
        loading={isCheckingAllProducts || undefined}
        disabled={isLoading || undefined}
        suppressHydrationWarning
      >
        {isCheckingAllProducts
          ? t("manualCheck.bulk.checkingAll")
          : coverage.uncheckedProductCount > 0
            ? t("actions.protectRemainingProducts", {
                count: coverage.uncheckedProductCount,
              })
            : t("actions.refreshCoverage")}
      </s-button>
      <s-button
        slot="secondary-actions"
        variant="secondary"
        href="/app/alerts"
        suppressHydrationWarning
      >
        {t("actions.viewAlerts")}
      </s-button>

      <div className="admin-stack">
        <AdminCard className="admin-card">
          <div className="admin-card__header">
            <div>
              <p className="admin-eyebrow">
                {t("manualCheck.coverage.eyebrow")}
              </p>
              <h2 className="admin-card__title">
                {coverage.isComplete
                  ? t("manualCheck.coverage.completeTitle")
                  : t("workspace.coverageIncomplete", {
                      count: coverage.uncheckedProductCount,
                    })}
              </h2>
              <p className="admin-card__description">
                {coverage.isComplete
                  ? t("manualCheck.coverage.completeDescription")
                  : t("manualCheck.coverage.incompleteDescription")}
              </p>
            </div>
            <div className="admin-actions">
              <s-badge tone={coverage.isComplete ? "success" : "warning"}>
                {t("manualCheck.coverage.percent", {
                  percent: coverage.coveragePercent,
                })}
              </s-badge>
              <s-button
                variant="secondary"
                loading={isCheckingAllProducts || undefined}
                disabled={isLoading || undefined}
                onClick={handleCheckAllProducts}
              >
                {isCheckingAllProducts
                  ? t("manualCheck.bulk.checkingAll")
                  : coverage.uncheckedProductCount > 0
                    ? t("manualCheck.bulk.checkAllProducts")
                    : t("actions.refreshCoverage")}
              </s-button>
            </div>
          </div>
          <div className="metric-grid">
            <SummaryCard
              title={t("manualCheck.coverage.productsCovered")}
              value={`${coverage.checkedProductCount}/${totalProducts || products.length}`}
              description={t("manualCheck.coverage.productsCoveredDescription")}
              progress={coverage.coveragePercent}
              progressTone={coverage.isComplete ? "success" : "warning"}
            />
            <SummaryCard
              title={t("manualCheck.coverage.lastRun")}
              value={
                lastRunAt ? (
                  <LocalDateTime
                    value={lastRunAt}
                    format={(date) => formatRelativeDate(date, t, dateLocale)}
                  />
                ) : (
                  t("status.notChecked")
                )
              }
              description={lastRunResult}
              badge={
                coverage.lastResultSafe === null ? undefined : (
                  <s-badge tone={coverage.lastResultSafe ? "info" : "warning"}>
                    {coverage.lastResultSafe
                      ? t("workspace.noMatch")
                      : t("workspace.possibleMatch")}
                  </s-badge>
                )
              }
            />
            <SummaryCard
              title={t("workspace.remaining")}
              value={coverage.uncheckedProductCount}
              description={
                coverage.uncheckedProductCount === 0
                  ? t("manualCheck.coverage.noneRemaining")
                  : t("manualCheck.coverage.remainingDescription")
              }
            />
          </div>
          <div
            className="admin-card__header admin-card__header--compact"
            style={{ marginTop: "var(--s-space-300)" }}
          >
            <div className="admin-inline-meta">
              <s-badge
                tone={
                  coverage.monitoringStatus === "FAILURE" ||
                  storeStats.activeAlerts > 0
                    ? "critical"
                    : coverage.isComplete
                      ? "success"
                      : "warning"
                }
              >
                {coverage.monitoringStatus === "FAILURE"
                  ? t("dashboard.admin.status.monitoringProblem.eyebrow")
                  : storeStats.activeAlerts > 0
                    ? t("manualCheck.badges.needsReview", {
                        count: storeStats.activeAlerts,
                      })
                    : coverage.isComplete
                      ? t("status.allClear")
                      : t("manualCheck.coverage.remaining")}
              </s-badge>
              <s-badge tone="info">
                {t("manualCheck.badges.checks", {
                  count: storeStats.totalChecks,
                })}
              </s-badge>
            </div>
          </div>
        </AdminCard>

        {fetcher.data && "error" in fetcher.data && fetcher.data.error && (
          <s-banner
            tone="critical"
            heading={t("manualCheck.banners.failedHeading")}
          >
            <s-text>{(fetcher.data as any).error}</s-text>
          </s-banner>
        )}

        {coverage.monitoringStatus === "FAILURE" && (
          <s-banner
            tone="critical"
            heading={t("dashboard.admin.status.monitoringProblem.title")}
          >
            <s-text>
              {t("dashboard.admin.status.monitoringProblem.description")}
            </s-text>
          </s-banner>
        )}

        {fetcher.data &&
          "alertCreated" in fetcher.data &&
          fetcher.data.alertCreated && (
            <s-banner
              tone="critical"
              heading={t("manualCheck.banners.alertHeading")}
            >
              <s-text>{t("manualCheck.banners.alertDescription")}</s-text>
              <div
                style={{
                  marginTop: "var(--s-space-200)",
                  display: "flex",
                  gap: "var(--s-space-200)",
                }}
              >
                <s-button
                  variant="primary"
                  commandFor="manual-check-result-modal"
                  command="--show"
                >
                  {t("actions.viewDetails")}
                </s-button>
                <s-button variant="secondary" href="/app/alerts">
                  {t("actions.reviewAlerts")}
                </s-button>
              </div>
            </s-banner>
          )}

        {checkResult?.analysis?.mode === "text-only" && (
          <s-banner
            tone="info"
            heading={t("manualCheck.banners.textOnlyHeading")}
          >
            <s-text>{t("manualCheck.banners.textOnlyDescription")}</s-text>
          </s-banner>
        )}

        <AdminCard className="admin-card" id="product-catalogue">
          <div className="admin-card__header">
            <div>
              <p className="admin-eyebrow">{t("manualCheck.admin.catalog")}</p>
              <h2 className="admin-card__title">
                {t("manualCheck.catalogue.heading", { count: products.length })}
              </h2>
              <p className="admin-card__description">
                {t("manualCheck.admin.catalogDescription")}
              </p>
            </div>
          </div>
          <div
            className="admin-toolbar"
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "var(--s-space-300)",
            }}
          >
            <div
              style={{
                display: "flex",
                gap: "var(--s-space-200)",
                width: "100%",
              }}
            >
              <div style={{ flex: 1 }}>
                <s-text-field
                  label={t("manualCheck.catalogue.searchLabel")}
                  labelAccessibilityVisibility="exclusive"
                  placeholder={t("manualCheck.catalogue.searchPlaceholder")}
                  value={searchValue}
                  onInput={(event: any) =>
                    setSearchValue(event.currentTarget.value || "")
                  }
                />
              </div>
              <div className="admin-actions">
                <s-button variant="primary" onClick={applySearch}>
                  {t("actions.search")}
                </s-button>
                {search && (
                  <s-button
                    variant="secondary"
                    onClick={() => {
                      setSearchValue("");
                      navigate("/app/manual-check");
                    }}
                  >
                    {t("actions.clear")}
                  </s-button>
                )}
              </div>
            </div>

            <p className="admin-helper">{t("workspace.catalogScopeHelp")}</p>
            <p className="admin-helper">{t("workspace.coverageFiltersHelp")}</p>
            <s-select label={t("workspace.productStatus")} value={shopifyStatusFilter} onChange={(event: any) => setShopifyStatusFilter(event.currentTarget.value)}>
              <s-option value="all">{t("workspace.productStatusAll")}</s-option>
              <s-option value="ACTIVE">{t("workspace.productStatusActive")}</s-option>
              <s-option value="DRAFT">{t("workspace.productStatusDraft")}</s-option>
              <s-option value="ARCHIVED">{t("workspace.productStatusArchived")}</s-option>
            </s-select>
            {/* Quick filter chips */}
            <s-stack direction="inline" gap="small" blockAlign="center" wrap>
              <s-clickable-chip
                selected={tabFilter === "all" || undefined}
                onClick={() => setTabFilter("all")}
              >
                {t("manualCheck.filters.all", { count: filterCounts.all })}
              </s-clickable-chip>
              <s-clickable-chip
                selected={tabFilter === "unprotected" || undefined}
                onClick={() => setTabFilter("unprotected")}
              >
                {t("workspace.remaining")} ({filterCounts.unprotected})
              </s-clickable-chip>
              {filterCounts.needsReview > 0 && (
                <s-clickable-chip
                  selected={tabFilter === "needs_review" || undefined}
                  onClick={() => setTabFilter("needs_review")}
                >
                  {t("manualCheck.filters.needsReview", {
                    count: filterCounts.needsReview,
                  })}
                </s-clickable-chip>
              )}
              <s-clickable-chip
                selected={tabFilter === "safe" || undefined}
                onClick={() => setTabFilter("safe")}
              >
                {t("manualCheck.filters.safe", { count: filterCounts.safe })}
              </s-clickable-chip>
            </s-stack>
          </div>

          {filteredProducts.length === 0 ? (
            <div className="admin-empty-state">
              <h3>{t("manualCheck.catalogue.emptyHeading")}</h3>
              <p>{t("manualCheck.catalogue.emptyBody")}</p>
            </div>
          ) : (
            <s-table
              accessibilityLabel={t("manualCheck.catalogue.accessibilityLabel")}
            >
              <s-table-header-row>
                <s-table-header listSlot="primary">
                  {t("manualCheck.catalogue.columns.product")}
                </s-table-header>
                <s-table-header listSlot="inline">
                  {t("manualCheck.catalogue.columns.status")}
                </s-table-header>
                <s-table-header>
                  {t("manualCheck.catalogue.columns.action")}
                </s-table-header>
              </s-table-header-row>
              <s-table-body>
                {filteredProducts.slice(0, visibleCount).map((product: any) => {
                  const productId = product.id.replace(
                    "gid://shopify/Product/",
                    "",
                  );
                  const checks = checksByProduct[productId] || {
                    totalChecks: 0,
                    lastCheck: null,
                    isSafe: null,
                  };
                  const lastCheck = checks.lastCheck
                    ? new Date(checks.lastCheck.checkedAt)
                    : null;
                  const existingAlert = alertsByProduct[productId];
                  const hasAlert = Boolean(existingAlert);
                  const hasActiveAlert = existingAlert?.status === "active";
                  const isProductLoading =
                    isCheckingOneProduct && selectedProduct?.id === product.id;

                  let currentStatusTone = "neutral";
                  let currentStatusLabel = t(
                    "manualCheck.catalogue.status.notChecked",
                  );

                  if (hasActiveAlert) {
                    currentStatusTone = "critical";
                    currentStatusLabel = t("status.needsReview");
                  } else if (hasAlert) {
                    currentStatusTone = "info";
                    currentStatusLabel = t(
                      "manualCheck.catalogue.status.reviewed",
                    );
                  } else if (productStates[productId]?.state === "current") {
                    if (productStates[productId]?.current?.isSafe) {
                      currentStatusTone = "success";
                      currentStatusLabel = t(
                        "manualCheck.catalogue.status.safe",
                      );
                    } else {
                      currentStatusTone = "critical";
                      currentStatusLabel = t("status.needsReview");
                    }
                  }

                  if (
                    !hasActiveAlert &&
                    productStates[productId]?.state === "changed"
                  ) {
                    currentStatusTone = "warning";
                    currentStatusLabel = t("workspace.changed");
                  }
                  return (
                    <s-table-row key={product.id}>
                      <s-table-cell>
                        <div className="admin-product-cell">
                          {isProductLoading ? (
                            <div
                              className="pulsing-skeleton"
                              style={{
                                width: "40px",
                                height: "40px",
                                borderRadius: "var(--s-radius-100, 4px)",
                              }}
                            />
                          ) : (
                            <s-thumbnail
                              src={product.featuredImage?.url}
                              alt={product.title}
                              size="small"
                            />
                          )}
                          <div className="admin-product-cell__content">
                            {isProductLoading ? (
                              <>
                                <div
                                  className="pulsing-skeleton skeleton-row-bar"
                                  style={{ width: "150px" }}
                                />
                                <div
                                  className="pulsing-skeleton skeleton-row-bar"
                                  style={{ width: "100px", height: "10px" }}
                                />
                              </>
                            ) : (
                              <>
                                <strong>{product.title}</strong>
                                <p>{t("workspace.productStatus")}: {t(product.status === "ACTIVE" ? "workspace.productStatusActive" : product.status === "DRAFT" ? "workspace.productStatusDraft" : product.status === "ARCHIVED" ? "workspace.productStatusArchived" : "workspace.productStatusUnknown")}</p>
                                <p>
                                  {product.vendor ||
                                    t("manualCheck.catalogue.unknownVendor")}
                                  {product.productType
                                    ? ` • ${product.productType}`
                                    : ""}
                                </p>
                              </>
                            )}
                          </div>
                        </div>
                      </s-table-cell>

                      <s-table-cell>
                        <div className="admin-status-stack">
                          {isProductLoading ? (
                            <div
                              className="pulsing-skeleton skeleton-row-bar"
                              style={{
                                width: "80px",
                                height: "24px",
                                borderRadius: "12px",
                              }}
                            />
                          ) : (
                            <>
                              <s-badge tone={currentStatusTone}>
                                {currentStatusLabel}
                              </s-badge>
                              {hasActiveAlert &&
                                productStates[productId]?.state !==
                                  "current" && (
                                  <span className="admin-helper">
                                    {t(
                                      productStates[productId]?.state ===
                                        "changed"
                                        ? "workspace.changed"
                                        : "workspace.unchecked",
                                    )}
                                  </span>
                                )}
                              {lastCheck && (
                                <span className="admin-helper">
                                  <LocalDateTime
                                    value={lastCheck}
                                    format={(date) =>
                                      formatRelativeDate(date, t, dateLocale)
                                    }
                                  />
                                </span>
                              )}
                            </>
                          )}
                        </div>
                      </s-table-cell>

                      <s-table-cell>
                        <div className="admin-actions">
                          {hasAlert && !isProductLoading && (
                            <s-button
                              size="small"
                              variant="secondary"
                              accessibilityLabel={t(
                                "manualCheck.catalogue.actions.viewForProduct",
                                { title: product.title },
                              )}
                              commandFor={`manual-alert-${existingAlert.id}`}
                              command="--show"
                            >
                              {t("actions.view")}
                            </s-button>
                          )}
                          <s-button
                            size="small"
                            variant={
                              checks.totalChecks > 0 ? "secondary" : "primary"
                            }
                            accessibilityLabel={
                              checks.totalChecks > 0
                                ? t(
                                    "manualCheck.catalogue.actions.checkAgainForProduct",
                                    { title: product.title },
                                  )
                                : t(
                                    "manualCheck.catalogue.actions.checkSafetyForProduct",
                                    { title: product.title },
                                  )
                            }
                            loading={isProductLoading || undefined}
                            disabled={isLoading || undefined}
                            onClick={() => handleProductCheck(product)}
                          >
                            {checks.totalChecks > 0
                              ? t("manualCheck.catalogue.actions.checkAgain")
                              : t("manualCheck.catalogue.actions.checkSafety")}
                          </s-button>
                        </div>
                      </s-table-cell>
                    </s-table-row>
                  );
                })}
              </s-table-body>
            </s-table>
          )}
        </AdminCard>
      </div>

      {filteredProducts.length > visibleCount && (
        <s-button onClick={() => setVisibleCount((count) => count + 50)}>
          {t("workspace.showMore")}
        </s-button>
      )}
      <p className="admin-helper" role="status">
        {t("workspace.coverageScope", {
          visible: Math.min(filteredProducts.length, visibleCount),
          total: totalProducts,
        })}
      </p>
      {/* Modals for existing alerts - same as Alerts page */}
      {existingAlerts.map((alert) => (
        <AlertDetailModal
          key={alert.id}
          modalId={`manual-alert-${alert.id}`}
          alert={alert}
          onResolve={(id, resolutionType, notes) =>
            handleResolve(id, resolutionType, notes)
          }
          onDismiss={(id, resolutionType, notes) =>
            handleDismiss(id, resolutionType, notes)
          }
          onReactivate={(id) => handleReactivate(id)}
          isLoading={resolveFetcher.state === "submitting"}
        />
      ))}

      {/* New check result modal - for freshly checked products */}
      {checkResult &&
        (() => {
          // Transform checkResult to match Alerts page format
          const warnings = Array.isArray(checkResult?.warnings)
            ? checkResult.warnings
            : [];
          const firstWarning = warnings[0];
          const alertType =
            firstWarning?.alertType ||
            firstWarning?.alertDetails?.fields?.alert_type ||
            "Unknown";
          const riskDescription =
            firstWarning?.riskLegalProvision ||
            firstWarning?.alertDetails?.fields?.risk_legal_provision ||
            "";
          const alertDetails = firstWarning?.alertDetails || null;
          const riskLevel =
            firstWarning?.alertDetails?.fields?.alert_level ||
            firstWarning?.alertDetails?.fields?.risk_level ||
            firstWarning?.riskLevel ||
            "Unknown";

          const newAlert = {
            id: currentAlertId,
            shop,
            productId:
              selectedProduct?.id?.replace("gid://shopify/Product/", "") || "",
            productTitle:
              selectedProduct?.title || t("manualCheck.modal.unknownProduct"),
            productImage:
              selectedProduct?.featuredImage?.url ||
              selectedProduct?.images?.nodes?.[0]?.url ||
              null,
            riskLevel,
            alertType,
            riskDescription,
            alertDetails,
            status: checkResult.isSafe ? "resolved" : "active",
            warningsCount: warnings.length,
            checkResult: JSON.stringify(checkResult),
            notes: null,
            createdAt: new Date().toISOString(),
          };

          return (
            <AlertDetailModal
              modalId="manual-check-result-modal"
              alert={newAlert}
              onResolve={currentAlertId ? handleResolve : undefined}
              onDismiss={currentAlertId ? handleDismiss : undefined}
              onReactivate={currentAlertId ? handleReactivate : undefined}
              isLoading={resolveFetcher.state === "submitting"}
            />
          );
        })()}
    </s-page>
  );
}
