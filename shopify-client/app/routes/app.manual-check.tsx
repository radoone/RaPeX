import { useState, useCallback, useEffect } from "react";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { useLoaderData, useFetcher, useNavigate } from "@remix-run/react";
import { json } from "@remix-run/node";
import { useTranslation } from "react-i18next";
import { authenticate } from "../shopify.server";
import { shopifyProductToProductData } from "../services/safety-gate-checker.client";
import { checkProductSafety, getSimilarityThresholdForShop } from "../services/safety-gate-checker.server";
import prisma from "../db.server";
import { SafetyGatePortal, AlertDetailModal, PageHeader, SummaryCard } from "../components";
import { AlertTable, type ResolutionType, formatRelativeDate } from "../components/AlertTable";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);

  const productsResponse = await admin.graphql(`
    query getProducts($first: Int!) {
      products(first: $first, sortKey: UPDATED_AT, reverse: true) {
        edges {
          node {
            id title handle vendor productType tags description
            featuredImage { url altText }
            variants(first: 5) { edges { node { id title price image { url } } } }
            updatedAt createdAt
          }
        }
      }
    }
  `, { variables: { first: 50 } });

  const productsJson = await productsResponse.json();
  const products = productsJson.data?.products?.edges?.map((e: any) => e.node) || [];

  const productIds = products.map((p: any) => p.id.replace('gid://shopify/Product/', ''));

  // Load safety checks
  const productChecks = await (prisma as any).safetyCheck.findMany({
    where: { shop: session.shop, productId: { in: productIds } },
    orderBy: { checkedAt: 'desc' },
  });

  // Load existing alerts for products (same transformation as Alerts page)
  const rawAlerts = await (prisma as any).safetyAlert.findMany({
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

  return json({ products, checksByProduct, alertsByProduct });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const action = formData.get("action") as string;

  if (action === "checkProduct") {
    const productData = JSON.parse(formData.get("productData") as string);
    const productId = formData.get("productId") as string;
    const productTitle = formData.get("productTitle") as string;

    try {
      const threshold = await getSimilarityThresholdForShop(session.shop);
      const safetyResult = await checkProductSafety(productData, threshold);

      let alertId: string | null = null;

      if (!safetyResult.isSafe && safetyResult.warnings.length > 0) {
        const existing = await (prisma as any).safetyAlert.findFirst({ where: { productId, shop: session.shop, status: 'active' } });
        if (!existing) {
          // Risk level is stored in alertDetails.fields.alert_level from Safety Gate API
          const firstWarning = safetyResult.warnings[0];
          const riskLevel = firstWarning?.alertDetails?.fields?.alert_level ||
            firstWarning?.alertDetails?.fields?.risk_level ||
            firstWarning?.riskLevel ||
            'unknown';
          const newAlert = await (prisma as any).safetyAlert.create({
            data: { productId, productTitle, shop: session.shop, checkResult: JSON.stringify(safetyResult), status: 'active', riskLevel, warningsCount: safetyResult.warnings.length },
          });
          alertId = newAlert.id;
        } else {
          alertId = existing.id;
        }
      }

      await (prisma as any).safetyCheck.create({
        data: { productId, productTitle, shop: session.shop, isSafe: safetyResult.isSafe, checkedAt: new Date(safetyResult.checkedAt) },
      });

      return json({ success: true, result: safetyResult, alertCreated: !safetyResult.isSafe && safetyResult.warnings.length > 0, alertId });
    } catch (error) {
      return json({ success: false, error: error instanceof Error ? error.message : 'Unknown error' });
    }
  }

  // Handle resolve action
  if (action === "resolve") {
    const alertId = formData.get("alertId") as string;
    const resolutionType = formData.get("resolutionType") as string | null;

    try {
      await (prisma as any).safetyAlert.update({
        where: { id: alertId },
        data: {
          status: "resolved",
          resolvedAt: new Date(),
          resolutionType: resolutionType || null,
        },
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

    try {
      await (prisma as any).safetyAlert.update({
        where: { id: alertId },
        data: {
          status: "dismissed",
          dismissedAt: new Date(),
          dismissedBy: session.shop,
          resolutionType: resolutionType || null,
        },
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
      await (prisma as any).safetyAlert.update({
        where: { id: alertId },
        data: {
          status: "active",
          dismissedAt: null,
          dismissedBy: null,
          resolvedAt: null,
          resolutionType: null,
        },
      });
      return json({ success: true, action: "reactivated" });
    } catch (error) {
      return json({ success: false, error: error instanceof Error ? error.message : 'Unknown error' });
    }
  }

  return json({ success: false, error: "Invalid action" });
};

export default function ManualCheckPage() {
  const { products, checksByProduct, alertsByProduct } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const resolveFetcher = useFetcher<typeof action>();
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();

  const [selectedProduct, setSelectedProduct] = useState<any>(null);
  const [checkResult, setCheckResult] = useState<any>(null);
  const [currentAlertId, setCurrentAlertId] = useState<string | null>(null);
  const [showResult, setShowResult] = useState(false);
  const [hasProcessedResult, setHasProcessedResult] = useState(false);
  const dateLocale = i18n.language === 'sk' ? 'sk-SK' : 'en-GB';

  // Get all alerts from alertsByProduct for modals
  const existingAlerts = Object.values(alertsByProduct || {}) as any[];

  const productCheckEntries = Object.values(checksByProduct || {});
  const checkedProducts = productCheckEntries.filter((e: any) => e.totalChecks > 0).length;
  const unsafeProducts = productCheckEntries.filter((e: any) => e.isSafe === false).length;
  const totalChecks = productCheckEntries.reduce((sum: number, e: any) => sum + e.totalChecks, 0);
  const coverageRate = products.length > 0 ? Math.round((checkedProducts / products.length) * 100) : 0;

  const handleProductCheck = useCallback((product: any) => {
    const productData = shopifyProductToProductData(product);
    fetcher.submit({
      action: "checkProduct",
      productData: JSON.stringify(productData),
      productId: product.id.replace('gid://shopify/Product/', ''),
      productTitle: product.title,
    }, { method: "POST" });
    setSelectedProduct(product);
    setHasProcessedResult(false);
  }, [fetcher]);

  const isLoading = fetcher.state === 'submitting';

  useEffect(() => {
    if (fetcher.data && 'success' in fetcher.data && fetcher.data.success && !showResult && !hasProcessedResult) {
      setCheckResult((fetcher.data as any).result);
      setCurrentAlertId((fetcher.data as any).alertId || null);
      setShowResult(true);
      setHasProcessedResult(true);
    }
  }, [fetcher.data, showResult, hasProcessedResult]);

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
  const handleResolve = useCallback((alertId: string, resolutionType?: ResolutionType) => {
    resolveFetcher.submit({
      action: "resolve",
      alertId,
      resolutionType: resolutionType || "",
    }, { method: "POST" });
  }, [resolveFetcher]);

  // Handle dismiss action
  const handleDismiss = useCallback((alertId: string, resolutionType?: ResolutionType) => {
    resolveFetcher.submit({
      action: "dismiss",
      alertId,
      resolutionType: resolutionType || "",
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
    <s-page size="large" className="page-shell">
      <PageHeader
        title={t('manualCheck.title')}
        subtitle={t('manualCheck.subtitle')}
        breadcrumbs={[
          { label: t('manualCheck.breadcrumbs.dashboard'), href: "/app" },
          { label: t('manualCheck.breadcrumbs.current') },
        ]}
        meta={(
          <>
            <s-badge tone={unsafeProducts > 0 ? "critical" : "success"}>
              {unsafeProducts === 0 ? t('status.allClear') : t('manualCheck.badges.flagged', { count: unsafeProducts })}
            </s-badge>
            <s-badge tone="info">{t('manualCheck.badges.checks', { count: totalChecks })}</s-badge>
          </>
        )}
        primaryAction={{ label: t('actions.viewAlerts'), href: "/app/alerts", variant: "primary" }}
        secondaryActions={[
          { label: t('actions.dashboard'), href: "/app", variant: "secondary" },
          { label: t('actions.settings'), href: "/app/settings", variant: "tertiary" },
        ]}
      />

      {/* Error/success banners */}
      {fetcher.data && 'error' in fetcher.data && fetcher.data.error && (
        <s-banner tone="critical" heading={t('manualCheck.banners.failedHeading')}>
          <s-text>{(fetcher.data as any).error}</s-text>
        </s-banner>
      )}

      {fetcher.data && 'alertCreated' in fetcher.data && fetcher.data.alertCreated && (
        <s-banner tone="warning" heading={t('manualCheck.banners.alertHeading')}>
          <s-text>{t('manualCheck.banners.alertDescription')}</s-text>
          <s-button
            slot="secondary-actions"
            variant="primary"
            commandFor="manual-check-result-modal"
            command="--show"
          >
            {t('actions.viewDetails')}
          </s-button>
          <s-button slot="secondary-actions" variant="secondary" href="/app/alerts">{t('actions.reviewAlerts')}</s-button>
        </s-banner>
      )}

      {/* Overview Metrics Cards - Shopify Style with Icons */}
      <s-section padding="base">
        <s-grid gridTemplateColumns="repeat(auto-fit, minmax(280px, 1fr))" gap="base">
          {/* Products in Scope Card */}
          <s-clickable
            border="base"
            borderRadius="large"
            padding="base"
            inlineSize="100%"
          >
            <s-grid gridTemplateColumns="auto 1fr" gap="base" alignItems="center">
              <s-box
                padding="small"
                borderRadius="full"
                background="bg-fill-info-secondary"
                inlineSize="40px"
                blockSize="40px"
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >
                <s-text size="large">📦</s-text>
              </s-box>
              <s-stack gap="small-200">
                <s-text tone="subdued" size="small">{t('manualCheck.overview.productsInScope')}</s-text>
                <s-stack direction="inline" gap="small" blockAlign="center">
                  <s-heading size="large">{products.length}</s-heading>
                  <s-badge tone="info">{t('status.updated')}</s-badge>
                </s-stack>
                <s-text tone="subdued" size="small">{t('manualCheck.overview.productsDescription')}</s-text>
              </s-stack>
            </s-grid>
          </s-clickable>

          {/* Manual Checks Completed Card */}
          <s-clickable
            border="base"
            borderRadius="large"
            padding="base"
            inlineSize="100%"
          >
            <s-grid gridTemplateColumns="auto 1fr" gap="base" alignItems="center">
              <s-box
                padding="small"
                borderRadius="full"
                background="bg-fill-success-secondary"
                inlineSize="40px"
                blockSize="40px"
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >
                <s-text size="large">✅</s-text>
              </s-box>
              <s-stack gap="small-200">
                <s-text tone="subdued" size="small">{t('manualCheck.overview.manualCompleted')}</s-text>
                <s-stack direction="inline" gap="small" blockAlign="center">
                  <s-heading size="large">{totalChecks}</s-heading>
                  <s-badge tone="info">{t('manualCheck.overview.coverage', { coverage: coverageRate })}</s-badge>
                </s-stack>
                {products.length > 0 && (
                  <s-progress-bar progress={coverageRate} tone="success" />
                )}
                <s-text tone="subdued" size="small">{t('manualCheck.overview.manualCompletedDescription', { checked: checkedProducts, total: products.length })}</s-text>
              </s-stack>
            </s-grid>
          </s-clickable>

          {/* Products Flagged Card */}
          <s-clickable
            onClick={() => navigate('/app/alerts?status=active')}
            border="base"
            borderRadius="large"
            padding="base"
            inlineSize="100%"
          >
            <s-grid gridTemplateColumns="auto 1fr" gap="base" alignItems="center">
              <s-box
                padding="small"
                borderRadius="full"
                background={unsafeProducts === 0 ? "bg-fill-success-secondary" : "bg-fill-critical-secondary"}
                inlineSize="40px"
                blockSize="40px"
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >
                <s-text size="large">{unsafeProducts === 0 ? "🛡️" : "⚠️"}</s-text>
              </s-box>
              <s-stack gap="small-200">
                <s-text tone="subdued" size="small">{t('manualCheck.overview.productsFlagged')}</s-text>
                <s-stack direction="inline" gap="small" blockAlign="center">
                  <s-heading size="large">{unsafeProducts}</s-heading>
                  <s-badge tone={unsafeProducts === 0 ? "success" : "critical"}>
                    {unsafeProducts === 0 ? t('status.allClear') : t('status.needsReview')}
                  </s-badge>
                </s-stack>
                <s-text tone="subdued" size="small">
                  {unsafeProducts === 0 ? t('manualCheck.overview.noRisks') : t('manualCheck.overview.prioritise')}
                </s-text>
              </s-stack>
            </s-grid>
          </s-clickable>
        </s-grid>
      </s-section>

      {/* Product list - using Polaris s-table for accessibility */}
      <s-section heading={t('manualCheck.catalogue.heading', { count: products.length })} padding="none">
        {products.length === 0 ? (
          <s-empty-state heading={t('manualCheck.catalogue.emptyHeading')}>
            <s-text>{t('manualCheck.catalogue.emptyBody')}</s-text>
          </s-empty-state>
        ) : (
          <s-table>
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

                // Check if product has an existing alert
                const existingAlert = alertsByProduct[productId];
                const hasAlert = !!existingAlert;

                return (
                  <s-table-row key={product.id}>
                    {/* Product Cell */}
                    <s-table-cell>
                      <s-stack direction="inline" gap="small" blockAlign="center">
                        <s-thumbnail src={product.featuredImage?.url} alt={product.title} size="small" />
                        <s-stack gap="small-100">
                          <s-text fontWeight="semibold">{product.title}</s-text>
                          <s-text tone="subdued" size="small">
                            {product.vendor || t('manualCheck.catalogue.unknownVendor')}
                          </s-text>
                        </s-stack>
                      </s-stack>
                    </s-table-cell>

                    {/* Status Cell */}
                    <s-table-cell>
                      <s-stack gap="small-100">
                        <s-badge tone={statusTone}>{statusLabel}</s-badge>
                        {lastCheck && (
                          <s-text tone="subdued" size="small">
                            {formatRelativeDate(lastCheck, t, dateLocale)}
                          </s-text>
                        )}
                      </s-stack>
                    </s-table-cell>

                    {/* Actions Cell */}
                    <s-table-cell>
                      <s-stack direction="inline" gap="small">
                        {/* View button - opens detail modal if alert exists */}
                        {hasAlert && (
                          <s-button
                            size="small"
                            variant="secondary"
                            commandFor={`manual-alert-${existingAlert.id}`}
                            command="--show"
                          >
                            {t('actions.view')}
                          </s-button>
                        )}
                        <s-button
                          size="small"
                          variant="primary"
                          loading={isLoading && selectedProduct?.id === product.id || undefined}
                          onClick={() => handleProductCheck(product)}
                        >
                          {checks.totalChecks > 0 ? t('manualCheck.catalogue.actions.checkAgain') : t('manualCheck.catalogue.actions.checkSafety')}
                        </s-button>
                      </s-stack>
                    </s-table-cell>
                  </s-table-row>
                );
              })}
            </s-table-body>
          </s-table>
        )}
      </s-section>

      <s-grid gap="base" gridTemplateColumns="repeat(auto-fit, minmax(240px, 1fr))">
        <s-section heading={t('manualCheck.quickActions.title')}>
          <s-stack gap="small">
            <s-button variant="secondary" href="/app">{t('actions.dashboard')}</s-button>
            <s-button variant="primary" href="/app/alerts">{t('actions.viewAlerts')}</s-button>
            <s-button variant="secondary" href="/app/settings">{t('actions.settings')}</s-button>
          </s-stack>
        </s-section>

        <SafetyGatePortal />
      </s-grid>

      {/* Modals for existing alerts - same as Alerts page */}
      {existingAlerts.map((alert) => (
        <AlertDetailModal
          key={alert.id}
          modalId={`manual-alert-${alert.id}`}
          alert={alert}
          onResolve={(id, resolutionType) => handleResolve(id, resolutionType)}
          onDismiss={(id, resolutionType) => handleDismiss(id, resolutionType)}
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
          productId: selectedProduct?.id?.replace('gid://shopify/Product/', '') || '',
          productTitle: selectedProduct?.title || t('manualCheck.modal.unknownProduct'),
          productImage: selectedProduct?.featuredImage?.url || fallbackImage || null,
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
