import { useState, useCallback, useEffect } from "react";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { useLoaderData, useFetcher, useNavigate, useRouteError, isRouteErrorResponse } from "@remix-run/react";
import { json } from "@remix-run/node";
import { useTranslation } from "react-i18next";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { shopifyProductToProductData } from "../services/safety-gate-checker.client";
import db from "../merchant-db.server";
import { firestore } from "../firestore.server";
import { runProductSafetyCheck } from "../services/product-safety-admin.server";
import { runMerchantDeltaMonitoring } from "../services/safety-gate-checker.server";
import { AlertDetailModal, SummaryCard } from "../components";
import { type ResolutionType, formatRelativeDate } from "../components/AlertTable";
import { requireActiveBilling } from "../services/billing.server";

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

function merchantProductDocId(shop: string, productId: string): string {
  return `${encodeURIComponent(shop)}::${encodeURIComponent(productId)}`;
}

async function fetchCatalogProductsForManualCheck(admin: any, limit = 300): Promise<ShopifyCatalogProduct[]> {
  const products: ShopifyCatalogProduct[] = [];
  let after: string | null = null;
  let hasNextPage = true;

  while (hasNextPage && products.length < limit) {
    const first = Math.min(100, limit - products.length);
    const response: { json: () => Promise<any> } = await admin.graphql(`#graphql
      query manualCheckCatalogProducts($first: Int!, $after: String) {
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

    const jsonResponse: any = await response.json();
    const connection: any = jsonResponse.data?.products;
    const edges = connection?.edges || [];
    products.push(...edges.map((edge: any) => edge.node));
    hasNextPage = Boolean(connection?.pageInfo?.hasNextPage) && products.length < limit;
    after = connection?.pageInfo?.endCursor || null;
  }

  return products;
}

async function planCatalogChecksForManualCheck(params: {
  admin: any;
  shop: string;
  limit?: number;
}): Promise<CatalogCachePlan> {
  const products = await fetchCatalogProductsForManualCheck(params.admin, params.limit ?? 300);
  const refs = products.map((product) => {
    const productId = product.id.replace("gid://shopify/Product/", "");
    return firestore.collection("merchant_products").doc(merchantProductDocId(params.shop, productId));
  });
  const snapshots = refs.length > 0 ? await firestore.getAll(...refs) : [];
  const productsToCheck: ShopifyCatalogProduct[] = [];
  let cachedUnchanged = 0;

  products.forEach((product, index) => {
    const cached = snapshots[index];
    const cachedData = cached?.exists ? cached.data() : null;
    const cachedSourceUpdatedAt = typeof cachedData?.sourceUpdatedAt === "string"
      ? cachedData.sourceUpdatedAt.trim()
      : "";
    const incomingSourceUpdatedAt = typeof product.updatedAt === "string"
      ? product.updatedAt.trim()
      : "";
    const hasCachedVectors = Boolean(cachedData?.vector_text || cachedData?.vector_image);
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

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, billing, session } = await authenticate.admin(request);
  const billingRedirect = await requireActiveBilling(billing, session.shop);
  if (billingRedirect) return billingRedirect as never;
  const url = new URL(request.url);
  const search = url.searchParams.get("search")?.trim() || "";

  const productsResponse = await admin.graphql(`
    query getProducts($first: Int!, $query: String) {
      products(first: $first, sortKey: UPDATED_AT, reverse: true, query: $query) {
        edges {
          node {
            id title handle vendor productType tags description
            featuredImage { url altText }
            images(first: 4) { nodes { url altText } }
            variants(first: 5) { edges { node { id title price image { url } } } }
            updatedAt createdAt
          }
        }
      }
    }
  `, { variables: { first: 50, query: search || null } });

  const productsJson = await productsResponse.json();
  const products = productsJson.data?.products?.edges?.map((e: any) => e.node) || [];
  let totalProducts = products.length;

  try {
    const countResponse = await admin.graphql(`#graphql
      query manualCheckProductsCount {
        productsCount { count }
      }
    `);
    const countJson = await countResponse.json();
    totalProducts = countJson.data?.productsCount?.count || products.length;
  } catch (error) {
    console.error("Error loading product count for manual check page", error);
  }

  const productIds = products.map((p: any) => p.id.replace('gid://shopify/Product/', ''));

  // Load safety checks
  const productChecks = await db.safetyCheck.findMany({
    where: { shop: session.shop, productId: { in: productIds } },
    orderBy: { checkedAt: 'desc' },
  });

  // Load existing alerts for products (same transformation as Alerts page)
  const rawAlerts = await db.safetyAlert.findMany({
    where: { shop: session.shop, productId: { in: productIds } },
    orderBy: { createdAt: 'desc' },
  });

  // Transform alerts same as Alerts page
  const alertsByProduct: Record<string, any> = {};
  rawAlerts.forEach((alert: any) => {
    let alertType = 'Unknown', riskDescription = '', alertDetails = null, riskLevelFromResult = null;
    try {
      const checkResult = JSON.parse(alert.checkResult);
      const warnings = Array.isArray(checkResult?.warnings) ? checkResult.warnings : [];
      if (warnings.length > 0) {
        const first = warnings[0];
        alertType = first.alertType || first.alertDetails?.fields?.alert_type || 'Unknown';
        riskDescription = first.riskLegalProvision || first.alertDetails?.fields?.risk_legal_provision || '';
        alertDetails = first.alertDetails || null;
        riskLevelFromResult = first.alertDetails?.fields?.alert_level ||
          first.alertDetails?.fields?.risk_level ||
          first.riskLevel || null;
        const fields = first.alertDetails?.fields || {};
        const pics = [...(fields.pictures || []), fields.product_image].filter(Boolean);
        if (pics[0]) alertDetails = { ...alertDetails, fallbackImage: typeof pics[0] === 'string' ? pics[0] : pics[0].url };
      }
    } catch { }
    const effectiveRiskLevel = riskLevelFromResult || (alert.riskLevel !== 'unknown' ? alert.riskLevel : null) || 'Unknown';

    // Get product image from products array
    const product = products.find((p: any) => p.id.replace('gid://shopify/Product/', '') === alert.productId);

    const transformedAlert = {
      ...alert, alertType, riskDescription, alertDetails,
      riskLevel: effectiveRiskLevel,
      productImage: product?.featuredImage?.url || alertDetails?.fallbackImage || null,
    };

    // Store by productId - keep the most recent/active one
    if (!alertsByProduct[alert.productId] || alert.status === 'active') {
      alertsByProduct[alert.productId] = transformedAlert;
    }
  });

  const checksByProduct = productChecks.reduce((acc: any, check: any) => {
    if (!acc[check.productId]) acc[check.productId] = { checks: [], totalChecks: 0, lastCheck: null, isSafe: null, safeCount: 0, unsafeCount: 0 };
    acc[check.productId].checks.push(check);
    acc[check.productId].totalChecks++;
    if (!acc[check.productId].lastCheck || check.checkedAt > acc[check.productId].lastCheck.checkedAt) {
      acc[check.productId].lastCheck = check;
      acc[check.productId].isSafe = check.isSafe;
    }
    check.isSafe ? acc[check.productId].safeCount++ : acc[check.productId].unsafeCount++;
    return acc;
  }, {});

  return json({ products, checksByProduct, alertsByProduct, search, shop: session.shop, totalProducts });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, billing, session } = await authenticate.admin(request);
  const billingRedirect = await requireActiveBilling(billing, session.shop);
  if (billingRedirect) return billingRedirect as never;
  const formData = await request.formData();
  const action = formData.get("action") as string;
  const updateOwnedAlert = async (
    alertId: string,
    data: Parameters<typeof db.safetyAlert.update>[0]["data"],
  ) => {
    const alert = await db.safetyAlert.findFirst({
      where: { id: alertId, shop: session.shop },
    });

    if (!alert) {
      throw new Error("Alert not found");
    }

    return db.safetyAlert.update({
      where: { id: alert.id },
      data,
    });
  };

  if (action === "checkProduct") {
    const productData = JSON.parse(formData.get("productData") as string);
    const productId = formData.get("productId") as string;
    const productTitle = formData.get("productTitle") as string;

    try {
      const runResult = await runProductSafetyCheck({
        shop: session.shop,
        productId,
        productTitle,
        productHandle: formData.get("productHandle") as string || undefined,
        productData,
        sourceUpdatedAt: formData.get("productUpdatedAt") as string || undefined,
      });
      return json({
        success: true,
        result: runResult.result,
        alertCreated: runResult.alertCreated,
        alertId: runResult.alertId,
      });
    } catch (error) {
      return json({ success: false, error: error instanceof Error ? error.message : 'Unknown error' });
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
          details: `Manual cached catalog check skipped ${checkPlan.cachedUnchanged} unchanged products, checked ${changedChecked} new or changed products, and scanned ${monitoring.productsScanned} cached products against new Safety Gate alerts.`
        }
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
      return json({ success: false, error: error instanceof Error ? error.message : "Full catalog check failed" }, { status: 500 });
    }
  }

  // Handle resolve action
  if (action === "resolve") {
    const alertId = formData.get("alertId") as string;
    const resolutionType = formData.get("resolutionType") as string | null;
    const notes = formData.get("notes") as string | null;

    try {
      await updateOwnedAlert(alertId, {
        status: "resolved",
        resolvedAt: new Date(),
        resolutionType: resolutionType || null,
        notes: notes?.trim() || null,
      });
      return json({ success: true, action: "resolved" });
    } catch (error) {
      return json({ success: false, error: error instanceof Error ? error.message : 'Unknown error' });
    }
  }

  // Handle dismiss action
  if (action === "dismiss") {
    const alertId = formData.get("alertId") as string;
    const resolutionType = formData.get("resolutionType") as string | null;
    const notes = formData.get("notes") as string | null;

    try {
      await updateOwnedAlert(alertId, {
        status: "dismissed",
        dismissedAt: new Date(),
        dismissedBy: session.shop,
        resolutionType: resolutionType || null,
        notes: notes?.trim() || null,
      });
      return json({ success: true, action: "dismissed" });
    } catch (error) {
      return json({ success: false, error: error instanceof Error ? error.message : 'Unknown error' });
    }
  }

  // Handle reactivate action
  if (action === "reactivate") {
    const alertId = formData.get("alertId") as string;

    try {
      await updateOwnedAlert(alertId, {
        status: "active",
        dismissedAt: null,
        dismissedBy: null,
        resolvedAt: null,
        resolutionType: null,
      });
      return json({ success: true, action: "reactivated" });
    } catch (error) {
      return json({ success: false, error: error instanceof Error ? error.message : 'Unknown error' });
    }
  }

  return json({ success: false, error: "Invalid action" });
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
      <s-heading slot="title" size="large" suppressHydrationWarning>{t("manualCheck.title")}</s-heading>
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

export default function ManualCheckPage() {
  const { products, checksByProduct, alertsByProduct, search, shop, totalProducts } = useLoaderData<typeof loader>();
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
  const dateLocale = i18n.language === 'sk' ? 'sk-SK' : 'en-GB';

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
  const existingAlerts = Object.values(alertsByProduct || {}) as any[];

  const productCheckEntries = Object.values(checksByProduct || {});
  const activeReviewProducts = Object.values(alertsByProduct || {}).filter((alert: any) => alert.status === "active").length;
  const totalChecks = productCheckEntries.reduce((sum: number, e: any) => sum + e.totalChecks, 0);
  const applySearch = useCallback(() => {
    const params = new URLSearchParams();
    const value = searchValue.trim();
    if (value) params.set("search", value);
    const query = params.toString();
    navigate(query ? `/app/manual-check?${query}` : "/app/manual-check");
  }, [navigate, searchValue]);

  const handleProductCheck = useCallback((product: any) => {
    const productData = shopifyProductToProductData(product);
    fetcher.submit({
      action: "checkProduct",
      productData: JSON.stringify(productData),
      productId: product.id.replace('gid://shopify/Product/', ''),
      productTitle: product.title,
      productHandle: product.handle || "",
      productUpdatedAt: product.updatedAt || "",
    }, { method: "POST" });
    setSelectedProduct(product);
    setHasProcessedResult(false);
  }, [fetcher]);

  const activeFetcherAction = fetcher.formData?.get("action");
  const isLoading = fetcher.state === 'submitting';
  const isCheckingAllProducts = fetcher.state !== "idle" && activeFetcherAction === "checkAllProducts";
  const isCheckingOneProduct = fetcher.state !== "idle" && activeFetcherAction === "checkProduct";

  const handleCheckAllProducts = useCallback(() => {
    if (isLoading) return;
    fetcher.submit({
      action: "checkAllProducts",
    }, { method: "POST" });
  }, [fetcher, isLoading]);

  useEffect(() => {
    if (
      fetcher.data &&
      'success' in fetcher.data &&
      fetcher.data.success &&
      'result' in fetcher.data &&
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
    if (!fetcher.data || !('success' in fetcher.data) || !fetcher.data.success) {
      return;
    }

    if ('message' in fetcher.data && fetcher.data.message) {
      shopify.toast.show((fetcher.data as any).message);
      return;
    }

    if ('alertCreated' in fetcher.data && fetcher.data.alertCreated) {
      shopify.toast.show(t('manualCheck.toasts.flagged'));
      return;
    }

    shopify.toast.show(t('manualCheck.toasts.completed'));
  }, [fetcher.data, shopify, t]);

  // Handle resolve/dismiss completion - navigate to alerts if successful
  useEffect(() => {
    if (resolveFetcher.data && 'success' in resolveFetcher.data && resolveFetcher.data.success) {
      setShowResult(false);
      setCheckResult(null);
      setCurrentAlertId(null);
      setSelectedProduct(null);
      // Optionally navigate to alerts page to see the resolved alert
      // navigate('/app/alerts');
    }
  }, [resolveFetcher.data]);

  // Handle resolve action
  const handleResolve = useCallback((alertId: string, resolutionType?: ResolutionType, notes?: string) => {
    resolveFetcher.submit({
      action: "resolve",
      alertId,
      resolutionType: resolutionType || "",
      notes: notes || "",
    }, { method: "POST" });
  }, [resolveFetcher]);

  // Handle dismiss action
  const handleDismiss = useCallback((alertId: string, resolutionType?: ResolutionType, notes?: string) => {
    resolveFetcher.submit({
      action: "dismiss",
      alertId,
      resolutionType: resolutionType || "",
      notes: notes || "",
    }, { method: "POST" });
  }, [resolveFetcher]);

  // Handle reactivate action
  const handleReactivate = useCallback((alertId: string) => {
    resolveFetcher.submit({
      action: "reactivate",
      alertId,
    }, { method: "POST" });
  }, [resolveFetcher]);

  // Auto-open modal when result is ready
  useEffect(() => {
    if (showResult && checkResult) {
      // Open the modal using Polaris Web showOverlay() method
      const modal = document.getElementById('manual-check-result-modal') as HTMLElement & { showOverlay?: () => void };
      if (modal?.showOverlay) {
        modal.showOverlay();
      }
    }
  }, [showResult, checkResult]);

  return (
    <s-page size="large" className="page-shell" suppressHydrationWarning>
      <s-heading slot="title" size="large" suppressHydrationWarning>{t('manualCheck.title')}</s-heading>
      <s-button slot="secondary-actions" variant="secondary" href="/app/alerts" suppressHydrationWarning>
        {t('actions.viewAlerts')}
      </s-button>

      <div className="admin-stack">
        <section className="admin-card">
          <div className="admin-card__header">
            <div>
              <p className="admin-eyebrow">{t("manualCheck.admin.manualReview")}</p>
              <h2 className="admin-card__title">{t('manualCheck.subtitle')}</h2>
              <p className="admin-card__description">
                {t("manualCheck.admin.manualReviewDescription")}
              </p>
            </div>
            <div className="admin-actions">
              <s-button
                variant="primary"
                loading={isCheckingAllProducts || undefined}
                disabled={isLoading || undefined}
                onClick={handleCheckAllProducts}
              >
                {isCheckingAllProducts ? t("manualCheck.bulk.checkingAll") : t("manualCheck.bulk.checkAllProducts")}
              </s-button>
            </div>
          </div>
          <div className="admin-note">
            <strong>{t("manualCheck.bulk.title")}</strong>
            <span>{t("manualCheck.bulk.description", { count: totalProducts || products.length })}</span>
          </div>
          <div className="admin-card__header admin-card__header--compact">
            <div className="admin-inline-meta">
              <s-badge tone={activeReviewProducts > 0 ? "critical" : "success"}>
                {activeReviewProducts === 0 ? t('status.allClear') : t('manualCheck.badges.needsReview', { count: activeReviewProducts })}
              </s-badge>
              <s-badge tone="info">{t('manualCheck.badges.checks', { count: totalChecks })}</s-badge>
            </div>
          </div>
        </section>

        {fetcher.data && 'error' in fetcher.data && fetcher.data.error && (
          <s-banner tone="critical" heading={t('manualCheck.banners.failedHeading')}>
            <s-text>{(fetcher.data as any).error}</s-text>
          </s-banner>
        )}

        {fetcher.data && 'alertCreated' in fetcher.data && fetcher.data.alertCreated && (
          <s-banner tone="critical" heading={t('manualCheck.banners.alertHeading')}>
            <s-text>{t('manualCheck.banners.alertDescription')}</s-text>
            <div style={{ marginTop: "var(--s-space-200)", display: "flex", gap: "var(--s-space-200)" }}>
              <s-button
                variant="primary"
                commandFor="manual-check-result-modal"
                command="--show"
              >
                {t('actions.viewDetails')}
              </s-button>
              <s-button variant="secondary" href="/app/alerts">
                {t('actions.reviewAlerts')}
              </s-button>
            </div>
          </s-banner>
        )}

        {checkResult?.analysis?.mode === 'text-only' && (
          <s-banner tone="info" heading={t('manualCheck.banners.textOnlyHeading')}>
            <s-text>{t('manualCheck.banners.textOnlyDescription')}</s-text>
          </s-banner>
        )}

        <section className="metric-grid">
          <SummaryCard
            title={t('manualCheck.overview.productsInScope')}
            value={totalProducts || products.length}
            badge={<s-badge tone="info">{t('status.updated')}</s-badge>}
            description={t('manualCheck.overview.productsDescription')}
          />
          <SummaryCard
            title={t('manualCheck.overview.productsNeedingReview')}
            value={activeReviewProducts}
            badge={<s-badge tone={activeReviewProducts === 0 ? "success" : "critical"}>{activeReviewProducts === 0 ? t('status.allClear') : t('status.needsReview')}</s-badge>}
            description={activeReviewProducts === 0 ? t('manualCheck.overview.noOpenReviews') : t('manualCheck.overview.prioritise')}
          />
        </section>

        <section className="admin-card">
          <div className="admin-card__header">
            <div>
              <p className="admin-eyebrow">{t("manualCheck.admin.catalog")}</p>
              <h2 className="admin-card__title">{t('manualCheck.catalogue.heading', { count: products.length })}</h2>
              <p className="admin-card__description">
                {t("manualCheck.admin.catalogDescription")}
              </p>
            </div>
          </div>
          <div className="admin-toolbar">
            <s-text-field
              label={t("manualCheck.catalogue.searchLabel")}
              labelAccessibilityVisibility="exclusive"
              placeholder={t("manualCheck.catalogue.searchPlaceholder")}
              value={searchValue}
              onInput={(event: any) => setSearchValue(event.currentTarget.value || "")}
            />
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

          {products.length === 0 ? (
            <div className="admin-empty-state">
              <h3>{t('manualCheck.catalogue.emptyHeading')}</h3>
              <p>{t('manualCheck.catalogue.emptyBody')}</p>
            </div>
          ) : (
            <s-table accessibilityLabel={t('manualCheck.catalogue.accessibilityLabel')}>
              <s-table-header-row>
                <s-table-header listSlot="primary">{t('manualCheck.catalogue.columns.product')}</s-table-header>
                <s-table-header listSlot="inline">{t('manualCheck.catalogue.columns.status')}</s-table-header>
                <s-table-header>{t('manualCheck.catalogue.columns.action')}</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {products.map((product: any) => {
                  const productId = product.id.replace('gid://shopify/Product/', '');
                  const checks = checksByProduct[productId] || { totalChecks: 0, lastCheck: null, isSafe: null };
                  const lastCheck = checks.lastCheck ? new Date(checks.lastCheck.checkedAt) : null;
                  const statusTone = checks.lastCheck ? (checks.isSafe ? 'success' : 'critical') : 'info';
                  const statusLabel = checks.lastCheck
                    ? (checks.isSafe ? t('manualCheck.catalogue.status.safe') : t('manualCheck.catalogue.status.unsafe'))
                    : t('manualCheck.catalogue.status.notChecked');
                  const existingAlert = alertsByProduct[productId];
                  const hasAlert = Boolean(existingAlert);
                  const hasActiveAlert = existingAlert?.status === "active";
                  const isProductLoading = isCheckingOneProduct && selectedProduct?.id === product.id;
                  const currentStatusTone = hasActiveAlert ? "critical" : hasAlert ? "success" : statusTone;
                  const currentStatusLabel = hasActiveAlert
                    ? t('manualCheck.catalogue.status.unsafe')
                    : hasAlert
                      ? t('manualCheck.catalogue.status.reviewed')
                      : statusLabel;

                  return (
                    <s-table-row key={product.id}>
                      <s-table-cell>
                        <div className="admin-product-cell">
                          {isProductLoading ? (
                            <div className="pulsing-skeleton" style={{ width: '40px', height: '40px', borderRadius: 'var(--s-radius-100, 4px)' }} />
                          ) : (
                            <s-thumbnail src={product.featuredImage?.url} alt={product.title} size="small" />
                          )}
                          <div className="admin-product-cell__content">
                            {isProductLoading ? (
                              <>
                                <div className="pulsing-skeleton skeleton-row-bar" style={{ width: '150px' }} />
                                <div className="pulsing-skeleton skeleton-row-bar" style={{ width: '100px', height: '10px' }} />
                              </>
                            ) : (
                              <>
                                <strong>{product.title}</strong>
                                <p>
                                  {product.vendor || t('manualCheck.catalogue.unknownVendor')}
                                  {product.productType ? ` • ${product.productType}` : ""}
                                </p>
                              </>
                            )}
                          </div>
                        </div>
                      </s-table-cell>

                      <s-table-cell>
                        <div className="admin-status-stack">
                          {isProductLoading ? (
                            <div className="pulsing-skeleton skeleton-row-bar" style={{ width: '80px', height: '24px', borderRadius: '12px' }} />
                          ) : (
                            <>
                              <s-badge tone={currentStatusTone}>{currentStatusLabel}</s-badge>
                              {lastCheck && (
                                <span className="admin-helper">
                                  {formatRelativeDate(lastCheck, t, dateLocale)}
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
                              accessibilityLabel={t('manualCheck.catalogue.actions.viewForProduct', { title: product.title })}
                              commandFor={`manual-alert-${existingAlert.id}`}
                              command="--show"
                            >
                              {t('actions.view')}
                            </s-button>
                          )}
                          <s-button
                            size="small"
                            variant={checks.totalChecks > 0 ? "secondary" : "primary"}
                            accessibilityLabel={checks.totalChecks > 0
                              ? t('manualCheck.catalogue.actions.checkAgainForProduct', { title: product.title })
                              : t('manualCheck.catalogue.actions.checkSafetyForProduct', { title: product.title })}
                            loading={isProductLoading || undefined}
                            disabled={isLoading || undefined}
                            onClick={() => handleProductCheck(product)}
                          >
                            {checks.totalChecks > 0 ? t('manualCheck.catalogue.actions.checkAgain') : t('manualCheck.catalogue.actions.checkSafety')}
                          </s-button>
                        </div>
                      </s-table-cell>
                    </s-table-row>
                  );
                })}
              </s-table-body>
            </s-table>
          )}
        </section>
      </div>

      {/* Modals for existing alerts - same as Alerts page */}
      {existingAlerts.map((alert) => (
        <AlertDetailModal
          key={alert.id}
          modalId={`manual-alert-${alert.id}`}
          alert={alert}
          onResolve={(id, resolutionType, notes) => handleResolve(id, resolutionType, notes)}
          onDismiss={(id, resolutionType, notes) => handleDismiss(id, resolutionType, notes)}
          onReactivate={(id) => handleReactivate(id)}
          isLoading={resolveFetcher.state === 'submitting'}
        />
      ))}

      {/* New check result modal - for freshly checked products */}
      {checkResult && (() => {
        // Transform checkResult to match Alerts page format
        const warnings = Array.isArray(checkResult?.warnings) ? checkResult.warnings : [];
        const firstWarning = warnings[0];
        const alertType = firstWarning?.alertType || firstWarning?.alertDetails?.fields?.alert_type || 'Unknown';
        const riskDescription = firstWarning?.riskLegalProvision || firstWarning?.alertDetails?.fields?.risk_legal_provision || '';
        const alertDetails = firstWarning?.alertDetails || null;
        const riskLevel = firstWarning?.alertDetails?.fields?.alert_level ||
          firstWarning?.alertDetails?.fields?.risk_level ||
          firstWarning?.riskLevel || 'Unknown';

        // Get fallback image from warning if product has no image
        const fields = firstWarning?.alertDetails?.fields || {};
        const pics = [...(fields.pictures || []), fields.product_image].filter(Boolean);
        const fallbackImage = pics[0] ? (typeof pics[0] === 'string' ? pics[0] : pics[0].url) : null;

        const newAlert = {
          id: currentAlertId,
          shop,
          productId: selectedProduct?.id?.replace('gid://shopify/Product/', '') || '',
          productTitle: selectedProduct?.title || t('manualCheck.modal.unknownProduct'),
          productImage: selectedProduct?.featuredImage?.url || selectedProduct?.images?.nodes?.[0]?.url || fallbackImage || null,
          riskLevel,
          alertType,
          riskDescription,
          alertDetails,
          status: checkResult.isSafe ? 'resolved' : 'active',
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
            isLoading={resolveFetcher.state === 'submitting'}
          />
        );
      })()}
    </s-page>
  );
}
