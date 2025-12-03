import { useState, useCallback, useEffect } from "react";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { useLoaderData, useFetcher } from "@remix-run/react";
import { json } from "@remix-run/node";
import { useTranslation } from "react-i18next";
import { authenticate } from "../shopify.server";
import { shopifyProductToProductData } from "../services/safety-gate-checker.client";
import prisma from "../db.server";
import { SafetyGatePortal, AlertDetailModal, PageHeader, SummaryCard } from "../components";

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
  const productChecks = await (prisma as any).safetyCheck.findMany({
    where: { shop: session.shop, productId: { in: productIds } },
    orderBy: { checkedAt: 'desc' },
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

  return json({ products, checksByProduct });
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
      const { checkProductSafety, getSimilarityThresholdForShop } = await import("../services/safety-gate-checker.server");
      const threshold = await getSimilarityThresholdForShop(session.shop);
      const safetyResult = await checkProductSafety(productData, threshold);

      if (!safetyResult.isSafe && safetyResult.warnings.length > 0) {
        const existing = await (prisma as any).safetyAlert.findFirst({ where: { productId, shop: session.shop, status: 'active' } });
        if (!existing) {
          await (prisma as any).safetyAlert.create({
            data: { productId, productTitle, shop: session.shop, checkResult: JSON.stringify(safetyResult), status: 'active', riskLevel: safetyResult.warnings[0]?.riskLevel || 'unknown', warningsCount: safetyResult.warnings.length },
          });
        }
      }

      await (prisma as any).safetyCheck.create({
        data: { productId, productTitle, shop: session.shop, isSafe: safetyResult.isSafe, checkedAt: new Date(safetyResult.checkedAt) },
      });

      return json({ success: true, result: safetyResult, alertCreated: !safetyResult.isSafe && safetyResult.warnings.length > 0 });
    } catch (error) {
      return json({ success: false, error: error instanceof Error ? error.message : 'Unknown error' });
    }
  }

  return json({ success: false, error: "Invalid action" });
};

export default function ManualCheckPage() {
  const { products, checksByProduct } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const { t, i18n } = useTranslation();

  const [selectedProduct, setSelectedProduct] = useState<any>(null);
  const [checkResult, setCheckResult] = useState<any>(null);
  const [showResult, setShowResult] = useState(false);
  const [hasProcessedResult, setHasProcessedResult] = useState(false);
  const dateLocale = i18n.language === 'sk' ? 'sk-SK' : 'en-GB';

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
      setShowResult(true);
      setHasProcessedResult(true);
    }
  }, [fetcher.data, showResult, hasProcessedResult]);

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
          <s-button slot="secondary-actions" variant="secondary" href="/app/alerts">{t('actions.reviewAlerts')}</s-button>
        </s-banner>
      )}

      <s-section heading={t('manualCheck.overview.title')}>
        <div className="metric-grid">
          <SummaryCard
            title={t('manualCheck.overview.productsInScope')}
            value={products.length}
            description={t('manualCheck.overview.productsDescription')}
            badge={<s-badge tone="info">{t('status.updated')}</s-badge>}
          />
          <SummaryCard
            title={t('manualCheck.overview.manualCompleted')}
            value={totalChecks}
            badge={<s-badge tone="info">{t('manualCheck.overview.coverage', { coverage: coverageRate })}</s-badge>}
            progress={products.length > 0 ? coverageRate : undefined}
            description={t('manualCheck.overview.manualCompletedDescription', { checked: checkedProducts, total: products.length })}
          />
          <SummaryCard
            title={t('manualCheck.overview.productsFlagged')}
            value={unsafeProducts}
            badge={<s-badge tone={unsafeProducts === 0 ? "success" : "critical"}>{unsafeProducts === 0 ? t('status.allClear') : t('status.needsReview')}</s-badge>}
            description={unsafeProducts === 0 ? t('manualCheck.overview.noRisks') : t('manualCheck.overview.prioritise')}
          />
        </div>
      </s-section>

      {/* Product list */}
      <s-section heading={t('manualCheck.catalogue.heading', { count: products.length })}>
        {products.length === 0 ? (
          <s-empty-state heading={t('manualCheck.catalogue.emptyHeading')}>
            <s-text>{t('manualCheck.catalogue.emptyBody')}</s-text>
          </s-empty-state>
        ) : (
          <div className="catalogue-table">
            <div className="catalogue-row catalogue-row--header">
              <s-text>{t('manualCheck.catalogue.columns.product')}</s-text>
              <s-text>{t('manualCheck.catalogue.columns.status')}</s-text>
              <s-text>{t('manualCheck.catalogue.columns.checks')}</s-text>
              <s-text>{t('manualCheck.catalogue.columns.action')}</s-text>
            </div>
            {products.map((product: any) => {
              const productId = product.id.replace('gid://shopify/Product/', '');
              const checks = checksByProduct[productId] || { totalChecks: 0, lastCheck: null, isSafe: null };
              const lastCheck = checks.lastCheck ? new Date(checks.lastCheck.checkedAt) : null;
              const statusTone = checks.lastCheck ? (checks.isSafe ? 'success' : 'critical') : 'info';
              const statusLabel = checks.lastCheck
                ? (checks.isSafe ? t('manualCheck.catalogue.status.safe') : t('manualCheck.catalogue.status.unsafe'))
                : t('manualCheck.catalogue.status.notChecked');

              return (
                <div key={product.id} className="catalogue-row">
                  <div className="catalogue-product">
                    <s-thumbnail src={product.featuredImage?.url} alt={product.title} size="small" />
                    <div className="catalogue-meta">
                      <s-text fontWeight="bold">{product.title}</s-text>
                      <div className="catalogue-subtitle">
                        {product.vendor || t('manualCheck.catalogue.unknownVendor')} - {product.productType || t('manualCheck.catalogue.noType')}
                      </div>
                    </div>
                  </div>

                  <div className="catalogue-meta">
                    <s-badge tone={statusTone}>{statusLabel}</s-badge>
                    {lastCheck && (
                      <s-text tone="subdued" size="small">
                        {t('manualCheck.catalogue.lastChecked', { date: lastCheck.toLocaleDateString(dateLocale) })}
                      </s-text>
                    )}
                  </div>

                  <div className="catalogue-stat">
                    <s-text fontWeight="semibold">{t('manualCheck.catalogue.columns.checks')} {checks.totalChecks}</s-text>
                    <s-text tone="subdued" size="small">
                      {checks.totalChecks > 0 ? t('manualCheck.catalogue.totalChecks', { count: checks.totalChecks }) : t('manualCheck.catalogue.firstCheck')}
                    </s-text>
                  </div>

                  <div className="catalogue-actions">
                    <s-button
                      size="small"
                      variant="primary"
                      loading={isLoading && selectedProduct?.id === product.id || undefined}
                      onClick={() => handleProductCheck(product)}
                    >
                      {checks.totalChecks > 0 ? t('manualCheck.catalogue.actions.checkAgain') : t('manualCheck.catalogue.actions.checkSafety')}
                    </s-button>
                  </div>
                </div>
              );
            })}
          </div>
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

      {/* Result modal */}
      {checkResult && (
        <AlertDetailModal
          open={showResult}
          onClose={() => { setShowResult(false); setCheckResult(null); setSelectedProduct(null); }}
          alert={{
            productTitle: selectedProduct?.title || t('manualCheck.modal.unknownProduct'),
            productImage: selectedProduct?.featuredImage?.url || null,
            riskLevel: checkResult.warnings?.[0]?.riskLevel || t('manualCheck.modal.unknown'),
            alertType: checkResult.warnings?.[0]?.alertType || t('manualCheck.modal.unknown'),
            status: checkResult.isSafe ? 'resolved' : 'active',
            warningsCount: checkResult.warnings?.length || 0,
            checkResult: JSON.stringify(checkResult),
            notes: null
          }}
        />
      )}
    </s-page>
  );
}
