import { useState, useCallback, useEffect } from "react";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { useLoaderData, useFetcher } from "@remix-run/react";
import { json } from "@remix-run/node";
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

  const [selectedProduct, setSelectedProduct] = useState<any>(null);
  const [checkResult, setCheckResult] = useState<any>(null);
  const [showResult, setShowResult] = useState(false);
  const [hasProcessedResult, setHasProcessedResult] = useState(false);

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
        title="Manual safety check"
        subtitle="Run a targeted Safety Gate check for a specific product."
        breadcrumbs={[
          { label: "Dashboard", href: "/app" },
          { label: "Manual check" },
        ]}
        meta={(
          <>
            <s-badge tone={unsafeProducts > 0 ? "critical" : "success"}>
              {unsafeProducts === 0 ? "All clear" : `${unsafeProducts} flagged`}
            </s-badge>
            <s-badge tone="info">{totalChecks} checks</s-badge>
          </>
        )}
        primaryAction={{ label: "View alerts", href: "/app/alerts", variant: "primary" }}
        secondaryActions={[
          { label: "Dashboard", href: "/app", variant: "secondary" },
          { label: "Settings", href: "/app/settings", variant: "tertiary" },
        ]}
      />

      {/* Error/success banners */}
      {fetcher.data && 'error' in fetcher.data && fetcher.data.error && (
        <s-banner tone="critical" heading="Check failed">
          <s-text>{(fetcher.data as any).error}</s-text>
        </s-banner>
      )}

      {fetcher.data && 'alertCreated' in fetcher.data && fetcher.data.alertCreated && (
        <s-banner tone="warning" heading="Safety alert created">
          <s-text>A potential safety issue was found for this product.</s-text>
          <s-button slot="secondary-actions" variant="secondary" href="/app/alerts">Review alerts</s-button>
        </s-banner>
      )}

      <s-section heading="Checks overview">
        <div className="metric-grid">
          <SummaryCard
            title="Products in scope"
            value={products.length}
            description="Latest products from your store."
            badge={<s-badge tone="info">Updated</s-badge>}
          />
          <SummaryCard
            title="Manual checks completed"
            value={totalChecks}
            badge={<s-badge tone="info">{coverageRate}% coverage</s-badge>}
            progress={products.length > 0 ? coverageRate : undefined}
            description={`${checkedProducts} of ${products.length} products checked`}
          />
          <SummaryCard
            title="Products flagged"
            value={unsafeProducts}
            badge={<s-badge tone={unsafeProducts === 0 ? "success" : "critical"}>{unsafeProducts === 0 ? "All clear" : "Needs review"}</s-badge>}
            description={unsafeProducts === 0 ? "No risks detected yet." : "Prioritise these products for action."}
          />
        </div>
      </s-section>

      {/* Product list */}
      <s-section heading={`Product Catalogue (${products.length})`}>
        {products.length === 0 ? (
          <s-empty-state heading="No products found">
            <s-text>No products are available for checking.</s-text>
          </s-empty-state>
        ) : (
          <div className="catalogue-table">
            <div className="catalogue-row catalogue-row--header">
              <s-text>Product</s-text>
              <s-text>Status</s-text>
              <s-text>Checks</s-text>
              <s-text>Action</s-text>
            </div>
            {products.map((product: any) => {
              const productId = product.id.replace('gid://shopify/Product/', '');
              const checks = checksByProduct[productId] || { totalChecks: 0, lastCheck: null, isSafe: null };
              const lastCheck = checks.lastCheck ? new Date(checks.lastCheck.checkedAt) : null;
              const statusTone = checks.lastCheck ? (checks.isSafe ? 'success' : 'critical') : 'info';
              const statusLabel = checks.lastCheck ? (checks.isSafe ? 'Safe' : 'Unsafe') : 'Not checked';

              return (
                <div key={product.id} className="catalogue-row">
                  <div className="catalogue-product">
                    <s-thumbnail src={product.featuredImage?.url} alt={product.title} size="small" />
                    <div className="catalogue-meta">
                      <s-text fontWeight="bold">{product.title}</s-text>
                      <div className="catalogue-subtitle">
                        {product.vendor || 'Unknown vendor'} - {product.productType || 'No type'}
                      </div>
                    </div>
                  </div>

                  <div className="catalogue-meta">
                    <s-badge tone={statusTone}>{statusLabel}</s-badge>
                    {lastCheck && (
                      <s-text tone="subdued" size="small">Last checked {lastCheck.toLocaleDateString('en-GB')}</s-text>
                    )}
                  </div>

                  <div className="catalogue-stat">
                    <s-text fontWeight="semibold">{checks.totalChecks} checks</s-text>
                    <s-text tone="subdued" size="small">
                      {checks.totalChecks > 0 ? `${checks.totalChecks} total` : "Run your first check"}
                    </s-text>
                  </div>

                  <div className="catalogue-actions">
                    <s-button
                      size="small"
                      variant="primary"
                      loading={isLoading && selectedProduct?.id === product.id || undefined}
                      onClick={() => handleProductCheck(product)}
                    >
                      {checks.totalChecks > 0 ? 'Check again' : 'Check safety'}
                    </s-button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </s-section>

      <s-grid gap="base" gridTemplateColumns="repeat(auto-fit, minmax(240px, 1fr))">
        <s-section heading="Quick Actions">
          <s-stack gap="small">
            <s-button variant="secondary" href="/app">Dashboard</s-button>
            <s-button variant="primary" href="/app/alerts">View alerts</s-button>
            <s-button variant="secondary" href="/app/settings">Settings</s-button>
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
            productTitle: selectedProduct?.title || 'Unknown Product',
            productImage: selectedProduct?.featuredImage?.url || null,
            riskLevel: checkResult.warnings?.[0]?.riskLevel || 'Unknown',
            alertType: checkResult.warnings?.[0]?.alertType || 'Unknown',
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
