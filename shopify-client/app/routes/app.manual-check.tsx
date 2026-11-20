import { AdminCard } from "../components/AdminCard";
import { LocalDateTime } from "../components/LocalDateTime";
import { useState, useCallback, useEffect, useMemo } from "react";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import {
  useLoaderData,
  useFetcher,
  useNavigate,
  useRouteError,
  useSearchParams,
} from "react-router";
import { data as json } from "react-router";
import { useTranslation } from "react-i18next";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import db from "../merchant-db.server";
import { withOfficialReferences } from "../services/review-evidence.server";
import { firestore } from "../firestore.server";
import { runProductSafetyCheckForAdminProduct } from "../services/product-safety-admin.server";
import { AlertDetailModal } from "../components";
import {
  type ResolutionType,
  formatRelativeDate,
} from "../components/AlertTable";
import {
  getBillingStatus,
  requireActiveBilling,
} from "../services/billing.server";
import { catalogCheckStates } from "../services/catalog-state";
import { readAutomaticCatalogChecks } from "../services/catalog-check-queue.server";
import { hasOwnerTestAccess } from "../services/owner-test-access.server";
import { isWaitingForSupplier } from "../services/review-evidence";
import { ProductCheckExcludedError } from "../services/safety-gate-checker.server";
import { exclusionPreview } from "../services/exclusion-preview";
import { shopifyProductToProductData } from "../services/safety-gate-product-data";

type ShopifyCatalogProduct = {
  id: string;
  title: string;
  updatedAt?: string;
  [key: string]: unknown;
};

const manualBatchSize = 3;

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
              status
              vendor
              productType
              tags
              featuredImage { url altText }
              images(first: 1) { nodes { url altText } }
              updatedAt
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

async function loadCoverage(shop: string, products: ShopifyCatalogProduct[], ownerTestAccess: boolean, strict = false) {
  const [checks, merchant] = await Promise.all([
    db.safetyCheck.findMany({
      where: { shop },
      orderBy: { checkedAt: "desc" },
      select: { productId: true, sourceUpdatedAt: true, checkedAt: true, isSafe: true },
    }),
    firestore.collection("merchants").doc(encodeURIComponent(shop)).get(),
  ]);
  const productStates = catalogCheckStates(products, checks);
  const pending = products.filter(product =>
    productStates[product.id.replace("gid://shopify/Product/", "")].state !== "current"
  );
  const automaticProductIds = await readAutomaticCatalogChecks(merchant, pending, ownerTestAccess).catch(error => {
    if (strict) throw error;
    console.error("Could not read automatic catalog check receipts", { shop, error });
    return [];
  });
  const automaticIds = new Set(automaticProductIds);
  const unconfirmed = pending.filter(product =>
    !automaticIds.has(product.id.replace("gid://shopify/Product/", ""))
  );
  const manualExcluded = exclusionPreview(
    products.map(product => {
      const { brand, category } = shopifyProductToProductData(product);
      return { id: product.id, vendor: brand, productType: category };
    }),
    String(merchant.get("excludeVendors") || ""),
    String(merchant.get("excludeTypes") || ""),
  );
  const manualExcludedProductIds = new Set(manualExcluded.map(product => product.id.replace("gid://shopify/Product/", "")));
  const manualCandidates = unconfirmed.filter(product =>
    !manualExcludedProductIds.has(product.id.replace("gid://shopify/Product/", "")),
  );
  return { checks, productStates, pending, unconfirmed, automaticProductIds, manualCandidates, manualExcludedProductIds };
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

  const { checks: productChecks, productStates, pending, unconfirmed, automaticProductIds, manualCandidates, manualExcludedProductIds } = await loadCoverage(
    session.shop, coverageCatalogProducts, Boolean(billingStatus.ownerTestAccess),
  );

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
      brand: product?.vendor || alert.brand || null,
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

  const displayedProducts = new Set(productIds);
  const checksByProduct: Record<string, { totalChecks: number; checkedAt: Date }> = {};
  for (const check of productChecks) {
    if (!displayedProducts.has(check.productId)) continue;
    const entry = checksByProduct[check.productId] ??= { totalChecks: 0, checkedAt: check.checkedAt };
    entry.totalChecks++;
  }

  return json({
    products,
    checksByProduct,
    alertsByProduct,
    search,
    shop: session.shop,
    totalProducts,
    productStates,
    coverage: {
      checkedProductCount: totalProducts - pending.length,
      uncheckedProductCount: pending.length,
      automaticCount: pending.length - unconfirmed.length,
      automaticProductIds,
      manualCandidateCount: manualCandidates.length,
      manualExcludedProductIds: [...manualExcludedProductIds],
    },
    billingStatus,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, billing, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const action = formData.get("action") as string;

  if (action === "checkProduct" || action === "checkPendingProducts") {
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
    const productId = formData.get("productId") as string;

    try {
      const runResult = await runProductSafetyCheckForAdminProduct({
        admin,
        shop: session.shop,
        productId,
      });
      return json({
        success: true,
        result: runResult.result,
        alertCreated: runResult.alertCreated,
        alertId: runResult.alertId,
      });
    } catch (error) {
      if (error instanceof ProductCheckExcludedError) {
        return json({ success: false, excluded: true }, { status: 422 });
      }
      return json({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  if (action === "checkPendingProducts") {
    try {
      const [products, ownerTestAccess] = await Promise.all([
        fetchCatalogProductsForManualCheck(admin, Infinity),
        hasOwnerTestAccess(session.shop),
      ]);
      const { manualCandidates } = await loadCoverage(session.shop, products, ownerTestAccess, true);
      let checked = 0;
      let failed = 0;
      for (const product of manualCandidates.slice(0, manualBatchSize)) {
        try {
          await runProductSafetyCheckForAdminProduct({
            admin,
            shop: session.shop,
            productId: product.id.replace("gid://shopify/Product/", ""),
          });
          checked++;
        } catch (error) {
          failed++;
          console.error("Manual pending product check failed", { shop: session.shop, productId: product.id, error });
        }
      }
      return json({ success: failed === 0, pendingCheckResult: { checked, failed } });
    } catch (error) {
      console.error("Could not start remaining product checks", { shop: session.shop, error });
      return json({ success: false, pendingCheckFailed: true }, { status: 500 });
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
    billingStatus,
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
  const [searchParams] = useSearchParams();
  const [tabFilter, setTabFilter] = useState<
    "all" | "unprotected" | "needs_review" | "safe"
  >(() => search || searchParams.get("coverage") === "all"
    ? "all"
    : searchParams.get("coverage") === "remaining" || coverage.uncheckedProductCount > 0
      ? "unprotected" : "all");
  const [shopifyStatusFilter, setShopifyStatusFilter] = useState("all");
  const dateLocale = i18n.language === "en" ? "en-GB" : i18n.language;

  const filterCounts = useMemo(() => {
    let unprotected = 0;
    let needsReview = 0;
    let safe = 0;
    const scopedProducts = products.filter((product: any) => shopifyStatusFilter === "all" || product.status === shopifyStatusFilter);
    scopedProducts.forEach((product: any) => {
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
    return { all: scopedProducts.length, unprotected, needsReview, safe };
  }, [products, alertsByProduct, productStates, shopifyStatusFilter]);

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
        if (trimmedSearch) setTabFilter("all");
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

  const mayCheckManually = billingStatus.ownerTestAccess || billingStatus.developmentBypass ||
    (billingStatus.billingVerified && billingStatus.hasActivePayment);
  const manualCount = coverage.manualCandidateCount;
  const manualExcludedProductIds = new Set(coverage.manualExcludedProductIds);
  const manualBatchCount = Math.min(manualBatchSize, manualCount);
  const automaticProductIds = new Set(coverage.automaticProductIds);
  const noManualAccessKey = billingStatus.billingVerified ? "planRequired" : "planUnconfirmed";
  const coverageHelpKey = coverage.uncheckedProductCount === 0
    ? (totalProducts === 0 ? "empty" : "complete")
    : coverage.automaticCount === coverage.uncheckedProductCount
      ? "automaticOnly"
      : manualCount === 0
        ? null
      : mayCheckManually ? "manualHelp" : noManualAccessKey;

  const applySearch = useCallback(() => {
    const params = new URLSearchParams();
    const value = searchValue.trim();
    if (value) {
      params.set("search", value);
      setTabFilter("all");
    }
    const query = params.toString();
    navigate(query ? `/app/manual-check?${query}` : "/app/manual-check");
  }, [navigate, searchValue]);

  const handleProductCheck = useCallback(
    (product: any) => {
      fetcher.submit(
        {
          action: "checkProduct",
          productId: product.id.replace("gid://shopify/Product/", ""),
        },
        { method: "POST" },
      );
      setSelectedProduct(product);
      setShowResult(false);
      setCheckResult(null);
      setCurrentAlertId(null);
      setHasProcessedResult(false);
    },
    [fetcher],
  );

  const activeFetcherAction = fetcher.formData?.get("action");
  const isLoading = fetcher.state !== "idle";
  const isCheckingPendingProducts =
    fetcher.state !== "idle" && activeFetcherAction === "checkPendingProducts";
  const isCheckingOneProduct =
    fetcher.state !== "idle" && activeFetcherAction === "checkProduct";

  const handleCheckPendingProducts = useCallback(() => {
    if (isLoading) return;
    fetcher.submit(
      {
        action: "checkPendingProducts",
      },
      { method: "POST" },
    );
  }, [fetcher, isLoading]);

  useEffect(() => {
    if (
      fetcher.state === "idle" &&
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
  }, [fetcher.state, fetcher.data, showResult, hasProcessedResult]);

  useEffect(() => {
    if (
      !fetcher.data ||
      !("success" in fetcher.data) ||
      !fetcher.data.success
    ) {
      return;
    }

    if ("pendingCheckResult" in fetcher.data) return;

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

  return (
    <s-page size="large" className="page-shell" suppressHydrationWarning>
      <s-heading slot="title" size="large" suppressHydrationWarning>
        {t("manualCheck.title")}
      </s-heading>
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
              <h2 className="admin-card__title">
                {coverage.uncheckedProductCount > 0
                  ? t("pendingCoverage.title", { count: coverage.uncheckedProductCount })
                  : t(totalProducts === 0 ? "pendingCoverage.emptyTitle" : "manualCheck.coverage.completeTitle")}
              </h2>
              <p className="admin-card__description">
                {t("pendingCoverage.current", { checked: coverage.checkedProductCount, total: totalProducts })}
              </p>
              {coverage.automaticCount > 0 && manualCount > 0 && (
                <p className="admin-card__description">
                  {t("pendingCoverage.automaticCount", { count: coverage.automaticCount })}
                </p>
              )}
              {coverageHelpKey && <p className="admin-card__description">{t(`pendingCoverage.${coverageHelpKey}`)}</p>}
              {coverage.uncheckedProductCount > coverage.automaticCount + manualCount && (
                <s-link href="/app/settings">{t("settingsAdmin.exclusions.title")}</s-link>
              )}
            </div>
            {manualBatchCount > 0 && mayCheckManually && (
              <s-button
                variant="primary"
                onClick={handleCheckPendingProducts}
                loading={isCheckingPendingProducts || undefined}
                disabled={isLoading || undefined}
              >
                {t("pendingCoverage.checkBatch", { count: manualBatchCount })}
              </s-button>
            )}
            {manualCount > 0 && !mayCheckManually && (
              <s-button
                variant="secondary"
                href={billingStatus.billingVerified && billingStatus.pricingPlansUrl || "/app/settings"}
                target={billingStatus.billingVerified && billingStatus.pricingPlansUrl ? "_top" : undefined}
              >
                {t(billingStatus.billingVerified ? "billing.managePlanButton" : "settings.title")}
              </s-button>
            )}
          </div>
        </AdminCard>

        {fetcher.data && "pendingCheckResult" in fetcher.data && (
          <s-banner tone={fetcher.data.pendingCheckResult.failed ? "warning" : "success"}>
            <s-text>{t("pendingCoverage.batchResult", fetcher.data.pendingCheckResult)}</s-text>
          </s-banner>
        )}
        {fetcher.data && "pendingCheckFailed" in fetcher.data && (
          <s-banner tone="critical" heading={t("manualCheck.banners.failedHeading")} />
        )}

        {fetcher.data && "excluded" in fetcher.data && (
          <s-banner tone="info" heading={t("manualCheck.catalogue.status.notChecked")}>
            <s-link href="/app/settings">{t("settingsAdmin.exclusions.title")}</s-link>
          </s-banner>
        )}
        {fetcher.data && "error" in fetcher.data && fetcher.data.error && (
          <s-banner
            tone="critical"
            heading={t("manualCheck.banners.failedHeading")}
          >
            {selectedProduct && (
              <s-button variant="secondary" onClick={() => handleProductCheck(selectedProduct)} disabled={isLoading}>
                {t("actions.retry")}
              </s-button>
            )}
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
          <details className="catalog-coverage__filters" open>
            <summary>{t("pendingCoverage.filters")}</summary>
            <div className="catalog-coverage__filter-fields">
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

              <s-select label={t("workspace.productStatus")} value={shopifyStatusFilter} onChange={(event: any) => { setShopifyStatusFilter(event.currentTarget.value); setTabFilter("all"); }}>
                <s-option value="all">{t("workspace.productStatusAll")}</s-option>
                <s-option value="ACTIVE">{t("workspace.productStatusActive")}</s-option>
                <s-option value="DRAFT">{t("workspace.productStatusDraft")}</s-option>
                <s-option value="ARCHIVED">{t("workspace.productStatusArchived")}</s-option>
              </s-select>
            </div>
          </details>
          <div className="catalog-coverage__tabs">
            <s-stack direction="inline" gap="small" blockAlign="center" wrap>
              <s-clickable-chip
                selected={tabFilter === "unprotected" || undefined}
                onClick={() => setTabFilter("unprotected")}
              >
                {t("pendingCoverage.pendingTab")} ({filterCounts.unprotected})
              </s-clickable-chip>
              <s-clickable-chip
                selected={tabFilter === "all" || undefined}
                onClick={() => setTabFilter("all")}
              >
                {t("manualCheck.filters.all", { count: filterCounts.all })}
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
              {tabFilter === "unprotected" && coverage.uncheckedProductCount === 0 ? (
                <s-button onClick={() => setTabFilter("all")}>{t("pendingCoverage.viewAll")}</s-button>
              ) : (
                <>
                  <h3>{t("manualCheck.catalogue.emptyHeading")}</h3>
                  <p>{t("manualCheck.catalogue.emptyBody")}</p>
                </>
              )}
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
                  const checkHistory = checksByProduct[productId];
                  const hasPreviousCheck = Boolean(checkHistory?.totalChecks);
                  const lastCheck = checkHistory?.checkedAt;
                  const existingAlert = alertsByProduct[productId];
                  const hasAlert = Boolean(existingAlert);
                  const hasActiveAlert = existingAlert?.status === "active";
                  const waitingForSupplier = existingAlert && isWaitingForSupplier(existingAlert);
                  const isProductLoading =
                    isCheckingOneProduct && selectedProduct?.id === product.id;

                  const coverageState = productStates[productId]?.state;
                  const isPending = coverageState !== "current";
                  const isAutomatic = isPending && automaticProductIds.has(productId);
                  const excludedFromManual = manualExcludedProductIds.has(productId);
                  const pendingStatus = isAutomatic ? "automatic" : mayCheckManually ? "unconfirmed" : noManualAccessKey;
                  const currentStatusTone = isPending || waitingForSupplier
                    ? "warning"
                    : hasActiveAlert ? "critical" : "info";
                  const currentStatusLabel = t(
                    coverageState === "unchecked" ? "manualCheck.catalogue.status.notChecked"
                      : coverageState === "changed" ? "workspace.changed"
                        : waitingForSupplier ? "workspace.waiting"
                        : hasActiveAlert ? "manualCheck.catalogue.status.unsafe"
                          : hasAlert ? "manualCheck.catalogue.status.reviewed"
                            : productStates[productId]?.current?.isSafe
                              ? "manualCheck.catalogue.status.safe"
                              : "status.needsReview"
                  );
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
                              {isPending && (
                                <span className="admin-helper">{t(`pendingCoverage.row.${pendingStatus}`)}</span>
                              )}
                              {!isPending && lastCheck && (
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
                          {mayCheckManually && !isAutomatic && excludedFromManual && (
                            <s-link href="/app/settings">{t("settingsAdmin.exclusions.title")}</s-link>
                          )}
                          {mayCheckManually && !isAutomatic && !excludedFromManual && (
                            <s-button
                              size="small"
                              variant="secondary"
                              accessibilityLabel={
                                hasPreviousCheck
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
                              {hasPreviousCheck
                                ? t("manualCheck.catalogue.actions.checkAgain")
                                : t("manualCheck.catalogue.actions.checkSafety")}
                            </s-button>
                          )}
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
            brand: selectedProduct?.vendor || null,
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
              openOnMount={showResult}
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
