import { useEffect, useState, useRef, useCallback } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useFetcher, useLoaderData, useNavigation, useNavigate, json } from "@remix-run/react";
import { useTranslation } from "react-i18next";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { LanguageSwitcher } from "../components";
import { checkProductSafety, getSimilarityThresholdForShop } from "../services/safety-gate-checker.server";
import { shopifyProductToProductData } from "../services/safety-gate-checker.client";

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

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);

  const [activeAlerts, totalAlerts, resolvedAlerts, dismissedAlerts, totalChecks, recentAlerts, checkedProductIds] = await Promise.all([
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
      where: { shop: session.shop },
      orderBy: { createdAt: 'desc' },
      take: 5,
    }),
    // Get list of already checked product IDs
    db.safetyCheck.findMany({
      where: { shop: session.shop },
      select: { productId: true },
      distinct: ['productId'],
    }),
  ]);

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

  const checkedProductCount = checkedProductIds.length;
  const uncheckedProductCount = Math.max(0, totalProductsCount - checkedProductCount);

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
    },
    recentAlerts: processedRecentAlerts,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const actionType = formData.get("action");
  const includeAlreadyChecked = formData.get("includeAlreadyChecked") === "true";

  if (actionType === "bulkCheck") {
    try {
      const results: BulkCheckResults = {
        processed: 0,
        checked: 0,
        skipped: 0,
        alertsCreated: 0,
        errors: 0,
        totalProducts: 0,
        products: [],
      };

      const similarityThreshold = await getSimilarityThresholdForShop(session.shop);

      // Get already checked product IDs if not including them
      let checkedProductIds: Set<string> = new Set();
      if (!includeAlreadyChecked) {
        const checkedProducts = await db.safetyCheck.findMany({
          where: { shop: session.shop },
          select: { productId: true },
          distinct: ['productId'],
        });
        checkedProductIds = new Set(checkedProducts.map(p => p.productId));
      }

      let hasNextPage = true;
      let cursor: string | null = null;

      // First, count total products
      const countResponse = await admin.graphql(`#graphql
        query { productsCount { count } }
      `);
      const countJson = await countResponse.json();
      results.totalProducts = countJson.data?.productsCount?.count || 0;

      while (hasNextPage) {
        const productsQuery = `
          query getProducts($first: Int!, $after: String) {
            products(first: $first, after: $after) {
              edges {
                node {
                  id
                  title
                  handle
                  productType
                  vendor
                  tags
                  description
                  descriptionHtml
                  featuredImage { url altText }
                  variants(first: 1) {
                    edges {
                      node {
                        id
                        title
                        selectedOptions { name value }
                        image { url altText }
                        price
                      }
                    }
                  }
                  updatedAt
                  createdAt
                }
                cursor
              }
              pageInfo { hasNextPage endCursor }
            }
          }
        `;

        const productsResponse: Response = await admin.graphql(productsQuery, {
          variables: { first: 50, after: cursor }
        });
        const productsJson: any = await productsResponse.json();

        if (!productsJson.data?.products) {
          throw new Error('Failed to fetch products from Shopify');
        }

        const { edges, pageInfo }: { edges: any[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } } = productsJson.data.products;
        hasNextPage = pageInfo.hasNextPage;
        cursor = pageInfo.endCursor;

        // Process products
        for (const edge of edges) {
          const product = edge.node;
          results.processed++;

          // Skip if already checked (unless includeAlreadyChecked is true)
          if (!includeAlreadyChecked && checkedProductIds.has(product.id)) {
            results.skipped++;
            results.products.push({
              id: product.id,
              title: product.title,
              status: 'skipped',
              message: 'Already checked',
            });
            continue;
          }

          try {
            const productData = shopifyProductToProductData(product);
            const safetyResult = await checkProductSafety(productData, similarityThreshold);
            results.checked++;

            if (!safetyResult.isSafe && safetyResult.warnings.length > 0) {
              const existingAlert = await db.safetyAlert.findFirst({
                where: { productId: product.id, shop: session.shop, status: 'active' },
              });

              if (!existingAlert) {
                await db.safetyAlert.create({
                  data: {
                    productId: product.id,
                    productTitle: product.title,
                    productHandle: product.handle,
                    shop: session.shop,
                    checkResult: JSON.stringify(safetyResult),
                    status: 'active',
                    riskLevel: safetyResult.warnings[0]?.alertDetails?.fields?.alert_level ||
                      safetyResult.warnings[0]?.alertDetails?.fields?.risk_level ||
                      safetyResult.warnings[0]?.riskLevel || 'Unknown',
                    warningsCount: safetyResult.warnings.length,
                  },
                });
                results.alertsCreated++;
                results.products.push({
                  id: product.id,
                  title: product.title,
                  status: 'alert_created',
                  message: `${safetyResult.warnings.length} safety issues found`,
                });
              } else {
                results.products.push({
                  id: product.id,
                  title: product.title,
                  status: 'checked',
                  message: 'Alert already exists',
                });
              }
            } else {
              results.products.push({
                id: product.id,
                title: product.title,
                status: 'checked',
                message: 'Safe',
              });
            }

            await db.safetyCheck.create({
              data: {
                productId: product.id,
                productTitle: product.title,
                shop: session.shop,
                isSafe: safetyResult.isSafe,
                checkedAt: new Date(safetyResult.checkedAt),
              },
            });

          } catch (error) {
            console.error('Bulk check error for product', product.id, product.title, error);
            results.errors++;
            results.products.push({
              id: product.id,
              title: product.title,
              status: 'error',
              message: error instanceof Error ? error.message : 'Unknown error',
            });
          }
        }

        // Small delay between pages
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      return json({
        success: true,
        message: `Checked ${results.checked} products, created ${results.alertsCreated} alerts`,
        results,
      });
    } catch (error) {
      console.error('Bulk check failed:', error);
      return json({ success: false, error: error instanceof Error ? error.message : 'Bulk check failed' }, { status: 500 });
    }
  }

  return json({ success: false, error: "Invalid action" }, { status: 400 });
};

export default function Index() {
  const { stats, recentAlerts } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<ActionResponse>();
  const navigation = useNavigation();
  const shopify = useAppBridge();
  const { t } = useTranslation();
  const navigate = useNavigate();

  // UI state
  const [visible, setVisible] = useState({
    banner: stats.activeAlerts > 0,
    setupGuide: stats.totalChecks === 0,
    calloutCard: true,
    news: true,
  });
  const [expanded, setExpanded] = useState({
    setupGuide: true,
    step1: false,
    step2: false,
    step3: false,
    results: false,
  });
  const [progress, setProgress] = useState(0);
  const [includeAlreadyChecked, setIncludeAlreadyChecked] = useState(false);

  // Button refs
  const bulkCheckBtnRef = useRef<HTMLElement>(null);
  const bulkCheckBtn2Ref = useRef<HTMLElement>(null);
  const bulkCheckBtn3Ref = useRef<HTMLElement>(null);
  const manualCheckBtnRef = useRef<HTMLElement>(null);
  const settingsBtnRef = useRef<HTMLElement>(null);

  const isLoading = navigation.state === "loading";
  const isSubmitting = fetcher.state === "submitting";

  const resolvedAlerts = stats.resolvedAlerts;
  const resolutionRate = stats.totalAlerts > 0 ? Math.round((resolvedAlerts / stats.totalAlerts) * 100) : 100;

  const runBulkCheck = useCallback(() => {
    if (isSubmitting) return;
    fetcher.submit(
      { action: 'bulkCheck', includeAlreadyChecked: includeAlreadyChecked.toString() },
      { method: 'POST' }
    );
  }, [isSubmitting, includeAlreadyChecked, fetcher]);

  const bulkResults = fetcher.data?.success && fetcher.data.results ? fetcher.data.results : null;

  // Native event listeners for buttons
  useEffect(() => {
    const bulkBtn = bulkCheckBtnRef.current;
    if (bulkBtn) {
      const handleClick = () => runBulkCheck();
      bulkBtn.addEventListener('click', handleClick);
      return () => bulkBtn.removeEventListener('click', handleClick);
    }
  }, [runBulkCheck]);

  useEffect(() => {
    const bulkBtn = bulkCheckBtn2Ref.current;
    if (bulkBtn) {
      const handleClick = () => runBulkCheck();
      bulkBtn.addEventListener('click', handleClick);
      return () => bulkBtn.removeEventListener('click', handleClick);
    }
  }, [runBulkCheck]);

  useEffect(() => {
    const bulkBtn = bulkCheckBtn3Ref.current;
    if (bulkBtn) {
      const handleClick = () => runBulkCheck();
      bulkBtn.addEventListener('click', handleClick);
      return () => bulkBtn.removeEventListener('click', handleClick);
    }
  }, [runBulkCheck]);

  useEffect(() => {
    const manualBtn = manualCheckBtnRef.current;
    if (manualBtn) {
      const handleClick = () => navigate('/app/manual-check');
      manualBtn.addEventListener('click', handleClick);
      return () => manualBtn.removeEventListener('click', handleClick);
    }
  }, [navigate]);

  useEffect(() => {
    const settingsBtn = settingsBtnRef.current;
    if (settingsBtn) {
      const handleClick = () => navigate('/app/settings');
      settingsBtn.addEventListener('click', handleClick);
      return () => settingsBtn.removeEventListener('click', handleClick);
    }
  }, [navigate]);

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
      <s-page>
        <s-section>
          <s-skeleton-text lines="3" />
        </s-section>
      </s-page>
    );
  }

  return (
    <s-page>
      {/* Page Title & Actions */}
      <s-heading slot="title" size="large">{t('nav.dashboard')}</s-heading>

      <s-button ref={bulkCheckBtnRef} slot="primary-action" variant="primary" loading={isSubmitting || undefined}>
        {isSubmitting ? t('actions.checking') : t('actions.checkAll')}
      </s-button>
      <s-button ref={manualCheckBtnRef} slot="secondary-actions" onClick={() => navigate('/app/manual-check')}>
        {t('actions.manualCheck')}
      </s-button>
      <s-button ref={settingsBtnRef} slot="secondary-actions" onClick={() => navigate('/app/settings')}>
        {t('actions.settings')}
      </s-button>

      {/* Active Alerts Banner */}
      {visible.banner && stats.activeAlerts > 0 && (
        <s-banner
          tone="critical"
          dismissible
          onDismiss={() => setVisible({ ...visible, banner: false })}
        >
          {t('dashboard.activeAlertsBanner.content', { count: stats.activeAlerts })}{' '}
          <s-link onClick={() => navigate('/app/alerts')}>{t('dashboard.activeAlertsBanner.reviewAction')}</s-link>
          {' • '}
          <s-link onClick={() => navigate('/app/manual-check')}>{t('dashboard.activeAlertsBanner.manualCheckAction')}</s-link>
        </s-banner>
      )}

      {/* Progress Banner during check */}
      {isSubmitting && (
        <s-banner tone="info" heading="🔍 Checking products...">
          <s-stack gap="small">
            <s-text>Please wait while we check your products against the Safety Gate database.</s-text>
            <s-progress-bar progress={50} accessibilityLabel="Checking products" />
            <s-text tone="subdued">This may take a few minutes depending on the number of products.</s-text>
          </s-stack>
        </s-banner>
      )}

      {/* Bulk Check Results Summary */}
      {bulkResults && (
        <s-section>
          <s-box padding="large" borderRadius="large" background="bg-surface-success" borderWidth="base" borderColor="border-success">
            <s-stack gap="base">
              <s-stack direction="inline" align="space-between" blockAlign="center">
                <s-heading>✅ Safety Check Complete</s-heading>
                <s-button
                  variant="tertiary"
                  icon={expanded.results ? "chevron-up" : "chevron-down"}
                  onClick={() => setExpanded({ ...expanded, results: !expanded.results })}
                >
                  {expanded.results ? 'Hide details' : 'Show details'}
                </s-button>
              </s-stack>

              {/* Summary stats */}
              <s-grid gridTemplateColumns="repeat(auto-fit, minmax(120px, 1fr))" gap="base">
                <s-box padding="base" borderRadius="base" background="bg-surface">
                  <s-text tone="subdued" size="small">Total Products</s-text>
                  <s-heading size="large">{bulkResults.totalProducts}</s-heading>
                </s-box>
                <s-box padding="base" borderRadius="base" background="bg-surface">
                  <s-text tone="subdued" size="small">Checked</s-text>
                  <s-heading size="large">{bulkResults.checked}</s-heading>
                </s-box>
                <s-box padding="base" borderRadius="base" background="bg-surface">
                  <s-text tone="subdued" size="small">Skipped</s-text>
                  <s-heading size="large">{bulkResults.skipped}</s-heading>
                </s-box>
                <s-box padding="base" borderRadius="base" background={bulkResults.alertsCreated > 0 ? "bg-surface-critical" : "bg-surface"}>
                  <s-text tone="subdued" size="small">Alerts Created</s-text>
                  <s-heading size="large">{bulkResults.alertsCreated}</s-heading>
                </s-box>
                {bulkResults.errors > 0 && (
                  <s-box padding="base" borderRadius="base" background="bg-surface-warning">
                    <s-text tone="subdued" size="small">Errors</s-text>
                    <s-heading size="large">{bulkResults.errors}</s-heading>
                  </s-box>
                )}
              </s-grid>

              {/* Detailed product list (expandable) */}
              {expanded.results && bulkResults.products.length > 0 && (
                <s-box padding="base" borderRadius="base" background="bg-surface" style={{ maxHeight: '400px', overflow: 'auto' }}>
                  <s-stack gap="small">
                    <s-text fontWeight="bold">Product Details</s-text>
                    {bulkResults.products.map((product, idx) => (
                      <s-stack key={idx} direction="inline" gap="small" align="space-between" blockAlign="center">
                        <s-stack direction="inline" gap="small" blockAlign="center">
                          {product.status === 'alert_created' && <s-badge tone="critical">⚠️ Alert</s-badge>}
                          {product.status === 'checked' && <s-badge tone="success">✓ Safe</s-badge>}
                          {product.status === 'skipped' && <s-badge tone="info">↷ Skipped</s-badge>}
                          {product.status === 'error' && <s-badge tone="warning">✕ Error</s-badge>}
                          <s-text>{product.title}</s-text>
                        </s-stack>
                        <s-text tone="subdued" size="small">{product.message}</s-text>
                      </s-stack>
                    ))}
                  </s-stack>
                </s-box>
              )}

              {/* Action buttons */}
              {bulkResults.alertsCreated > 0 && (
                <s-stack direction="inline" gap="small">
                  <s-button variant="primary" onClick={() => navigate('/app/alerts')}>
                    Review {bulkResults.alertsCreated} Alerts
                  </s-button>
                </s-stack>
              )}
            </s-stack>
          </s-box>
        </s-section>
      )}

      {/* Setup Guide - Always visible until products are checked */}
      {stats.totalChecks === 0 && (
        <s-section>
          <s-grid gap="small">
            <s-grid gap="small-200">
              <s-grid gridTemplateColumns="1fr auto" gap="small-300" alignItems="center">
                <s-heading>{t('dashboard.setup.title')}</s-heading>
                <s-button
                  onClick={() => setExpanded({ ...expanded, setupGuide: !expanded.setupGuide })}
                  variant="tertiary"
                  tone="neutral"
                  icon={expanded.setupGuide ? "chevron-up" : "chevron-down"}
                />
              </s-grid>
              <s-paragraph>{t('dashboard.setup.description')}</s-paragraph>
              <s-progress-bar
                progress={Math.round((progress / 3) * 100)}
                accessibilityLabel={t('dashboard.setup.progress', { completed: progress, total: 3 })}
              />
              <s-text tone="subdued" size="small">{t('dashboard.setup.progress', { completed: progress, total: 3 })}</s-text>
            </s-grid>

            <s-box borderRadius="base" border="base" background="base" display={expanded.setupGuide ? "auto" : "none"}>
              {/* Step 1 */}
              <s-box>
                <s-grid gridTemplateColumns="1fr auto" gap="base" padding="small">
                  <s-checkbox
                    label={t('dashboard.setup.steps.step1.label')}
                    onInput={(e: any) => setProgress(e.currentTarget?.checked ? progress + 1 : progress - 1)}
                  />
                  <s-button
                    onClick={() => setExpanded({ ...expanded, step1: !expanded.step1 })}
                    variant="tertiary"
                    icon={expanded.step1 ? "chevron-up" : "chevron-down"}
                  />
                </s-grid>
                <s-box padding="small" paddingBlockStart="none" display={expanded.step1 ? "auto" : "none"}>
                  <s-box padding="base" background="subdued" borderRadius="base">
                    <s-stack gap="small">
                      <s-paragraph>{t('dashboard.setup.steps.step1.description')}</s-paragraph>
                      <s-button ref={bulkCheckBtn2Ref} loading={isSubmitting || undefined}>
                        {t('actions.checkAll')}
                      </s-button>
                    </s-stack>
                  </s-box>
                </s-box>
              </s-box>
              <s-divider />

              {/* Step 2 */}
              <s-box>
                <s-grid gridTemplateColumns="1fr auto" gap="base" padding="small">
                  <s-checkbox
                    label={t('dashboard.setup.steps.step2.label')}
                    onInput={(e: any) => setProgress(e.currentTarget?.checked ? progress + 1 : progress - 1)}
                  />
                  <s-button
                    onClick={() => setExpanded({ ...expanded, step2: !expanded.step2 })}
                    variant="tertiary"
                    icon={expanded.step2 ? "chevron-up" : "chevron-down"}
                  />
                </s-grid>
                <s-box padding="small" paddingBlockStart="none" display={expanded.step2 ? "auto" : "none"}>
                  <s-box padding="base" background="subdued" borderRadius="base">
                    <s-paragraph>{t('dashboard.setup.steps.step2.description')}</s-paragraph>
                  </s-box>
                </s-box>
              </s-box>
              <s-divider />

              {/* Step 3 */}
              <s-box>
                <s-grid gridTemplateColumns="1fr auto" gap="base" padding="small">
                  <s-checkbox
                    label={t('dashboard.setup.steps.step3.label')}
                    onInput={(e: any) => setProgress(e.currentTarget?.checked ? progress + 1 : progress - 1)}
                  />
                  <s-button
                    onClick={() => setExpanded({ ...expanded, step3: !expanded.step3 })}
                    variant="tertiary"
                    icon={expanded.step3 ? "chevron-up" : "chevron-down"}
                  />
                </s-grid>
                <s-box padding="small" paddingBlockStart="none" display={expanded.step3 ? "auto" : "none"}>
                  <s-box padding="base" background="subdued" borderRadius="base">
                    <s-paragraph>{t('dashboard.setup.steps.step3.description')}</s-paragraph>
                  </s-box>
                </s-box>
              </s-box>
            </s-box>
          </s-grid>
        </s-section>
      )}

      {/* Metrics Cards - Shopify Style with Icons */}
      <s-section>
        <s-grid gridTemplateColumns="repeat(auto-fit, minmax(280px, 1fr))" gap="base">
          {/* Active Alerts Card */}
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
                background={stats.activeAlerts > 0 ? "bg-fill-critical-secondary" : "bg-fill-success-secondary"}
                inlineSize="40px"
                blockSize="40px"
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >
                <s-text size="large">{stats.activeAlerts > 0 ? "⚠️" : "✅"}</s-text>
              </s-box>
              <s-stack gap="small-200">
                <s-text tone="subdued" size="small">{t('dashboard.stats.activeAlerts')}</s-text>
                <s-stack direction="inline" gap="small" blockAlign="center">
                  <s-heading size="large">{stats.activeAlerts}</s-heading>
                  <s-badge tone={stats.activeAlerts > 0 ? "critical" : "success"}>
                    {stats.activeAlerts > 0 ? t('status.needsReview') : t('status.allClear')}
                  </s-badge>
                </s-stack>
              </s-stack>
            </s-grid>
          </s-clickable>

          {/* Alerts Logged Card */}
          <s-clickable
            onClick={() => navigate('/app/alerts')}
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
                <s-text size="large">📑</s-text>
              </s-box>
              <s-stack gap="small-200">
                <s-text tone="subdued" size="small">{t('dashboard.stats.alertsLogged')}</s-text>
                <s-stack direction="inline" gap="small" blockAlign="center">
                  <s-heading size="large">{stats.totalAlerts}</s-heading>
                  <s-badge tone="info">
                    {stats.resolvedAlerts > 0 ? t('dashboard.stats.resolved', { count: stats.resolvedAlerts }) : t('common.all')}
                  </s-badge>
                </s-stack>
              </s-stack>
            </s-grid>
          </s-clickable>

          {/* Products Checked Card */}
          <s-clickable
            onClick={() => navigate('/app/manual-check')}
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
                <s-text size="large">🛡️</s-text>
              </s-box>
              <s-stack gap="small-200">
                <s-text tone="subdued" size="small">{t('dashboard.stats.productsChecked')}</s-text>
                <s-stack direction="inline" gap="small" blockAlign="center">
                  <s-heading size="large">{stats.totalChecks}</s-heading>
                  <s-badge tone={stats.totalChecks > 0 ? "success" : "warning"}>
                    {stats.totalChecks > 0 ? t('dashboard.stats.autoMonitoring') : t('dashboard.stats.newSetup')}
                  </s-badge>
                </s-stack>
              </s-stack>
            </s-grid>
          </s-clickable>
        </s-grid>
      </s-section>

      {/* Recent Alerts */}
      <s-section>
        <s-grid gridTemplateColumns="1fr auto" alignItems="center" paddingBlockEnd="small-400">
          <s-stack direction="inline" gap="small" blockAlign="center">
            <s-heading>{t('dashboard.recentAlerts.title')}</s-heading>
            {recentAlerts.length > 0 && (
              <s-badge tone={recentAlerts.some(a => a.status === 'active') ? "critical" : "success"}>
                {recentAlerts.filter(a => a.status === 'active').length > 0
                  ? t('dashboard.recentAlerts.active', { count: recentAlerts.filter(a => a.status === 'active').length })
                  : t('dashboard.recentAlerts.allResolved')}
              </s-badge>
            )}
          </s-stack>
          <s-button onClick={() => navigate('/app/alerts')}>{t('actions.viewAlerts')}</s-button>
        </s-grid>

        {recentAlerts.length === 0 ? (
          <s-box padding="large" background="subdued" borderRadius="large" border="base">
            <s-stack gap="small" alignItems="center">
              <s-box padding="base" borderRadius="full" background="bg-fill-success-secondary">
                <s-icon name="checkmark" />
              </s-box>
              <s-heading size="small">{t('dashboard.recentAlerts.emptyState.heading')}</s-heading>
              <s-text tone="subdued" alignment="center">
                {t('dashboard.recentAlerts.emptyState.content')}
              </s-text>
            </s-stack>
          </s-box>
        ) : (
          <s-grid gridTemplateColumns="repeat(auto-fit, minmax(280px, 1fr))" gap="base">
            {recentAlerts.map((alert) => (
              <s-clickable
                key={alert.id}
                onClick={() => navigate('/app/alerts')}
                border="base"
                borderRadius="large"
                padding="base"
                inlineSize="100%"
              >
                <s-grid gridTemplateColumns="auto 1fr" alignItems="start" gap="base">
                  {alert.productImage ? (
                    <s-thumbnail size="small" src={alert.productImage} alt={alert.productTitle} />
                  ) : (
                    <s-box background="subdued" borderRadius="base" padding="small-400">
                      <s-icon name="product" />
                    </s-box>
                  )}
                  <s-box>
                    <s-heading size="small" style={{ marginBottom: '4px' }}>{alert.productTitle}</s-heading>
                    <s-stack direction="inline" gap="small-200" wrap>
                      <s-badge tone={alert.status === 'active' ? 'critical' : alert.status === 'resolved' ? 'success' : 'info'}>
                        {alert.status === 'active'
                          ? t('status.needsReview')
                          : alert.status === 'resolved'
                            ? t('status.resolved')
                            : t('status.dismissed')}
                      </s-badge>
                      {alert.alertType && (
                        <s-badge tone="warning">{alert.alertType}</s-badge>
                      )}
                    </s-stack>
                  </s-box>
                </s-grid>
              </s-clickable>
            ))}
          </s-grid>
        )}
      </s-section>

      {/* Check All Products Section - Moved down and made secondary if alerts exist */}
      <s-section>
        <s-box padding="base" border="base" borderRadius="large" background="bg-surface">
          <s-stack gap="base">
            <s-stack direction="inline" gap="small" blockAlign="center">
              <s-box background="bg-fill-info-secondary" borderRadius="base" padding="small-200" inlineSize="32px" blockSize="32px" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <s-text size="large">🔍</s-text>
              </s-box>
              <s-heading size="small">{t('dashboard.bulkCheck.title')}</s-heading>
            </s-stack>

            <s-grid gridTemplateColumns="repeat(auto-fit, minmax(140px, 1fr))" gap="base">
              <s-stack gap="small-100">
                <s-text tone="subdued" size="small">{t('dashboard.bulkCheck.totalProducts')}</s-text>
                <s-text fontWeight="bold" size="large">{stats.totalProducts}</s-text>
              </s-stack>
              <s-stack gap="small-100">
                <s-text tone="subdued" size="small">{t('dashboard.bulkCheck.alreadyChecked')}</s-text>
                <s-text fontWeight="bold" size="large">{stats.checkedProducts}</s-text>
              </s-stack>
              <s-stack gap="small-100">
                <s-text tone="subdued" size="small">{t('dashboard.bulkCheck.notYetChecked')}</s-text>
                <s-text fontWeight="bold" size="large" tone={stats.uncheckedProducts > 0 ? "warning" : "success"}>
                  {stats.uncheckedProducts}
                </s-text>
              </s-stack>
            </s-grid>

            <s-divider />

            <s-stack gap="small">
              <s-checkbox
                label={t('dashboard.bulkCheck.includeAlreadyChecked')}
                checked={includeAlreadyChecked || undefined}
                onInput={(e: any) => setIncludeAlreadyChecked(e.currentTarget?.checked)}
              />
              <s-text tone="subdued" size="small">
                {includeAlreadyChecked
                  ? t('dashboard.bulkCheck.willCheckAll', { count: stats.totalProducts })
                  : t('dashboard.bulkCheck.willCheckUnchecked', { count: stats.uncheckedProducts, skip: stats.checkedProducts })}
              </s-text>
            </s-stack>

            <s-button
              ref={bulkCheckBtn3Ref}
              variant="primary"
              loading={isSubmitting || undefined}
              disabled={stats.uncheckedProducts === 0 && !includeAlreadyChecked || undefined}
            >
              {isSubmitting
                ? t('actions.checking')
                : includeAlreadyChecked
                  ? t('actions.checkAllProducts', { count: stats.totalProducts })
                  : t('actions.checkUnchecked', { count: stats.uncheckedProducts })}
            </s-button>
          </s-stack>
        </s-box>
      </s-section>

      {/* News */}
      {visible.news && (
        <s-section>
          <s-grid gridTemplateColumns="1fr auto" alignItems="center" paddingBlockEnd="small-400">
            <s-heading>{t('news.title')}</s-heading>
            <s-button
              onClick={() => setVisible({ ...visible, news: false })}
              icon="x"
              tone="neutral"
              variant="tertiary"
            />
          </s-grid>
          <s-grid gridTemplateColumns="repeat(auto-fit, minmax(280px, 1fr))" gap="base">
            <s-box background="base" border="base" borderRadius="large" padding="base">
              <s-stack gap="small">
                <s-badge tone="info">{t('news.items.databaseUpdate.date')}</s-badge>
                <s-link href="https://ec.europa.eu/safety-gate-alerts/screen/home" target="_blank">
                  <s-heading size="small">{t('news.items.databaseUpdate.title')}</s-heading>
                </s-link>
                <s-text tone="subdued" size="small">{t('news.items.databaseUpdate.description')}</s-text>
              </s-stack>
            </s-box>
            <s-box background="base" border="base" borderRadius="large" padding="base">
              <s-stack gap="small">
                <s-badge tone="warning">{t('news.items.gpsr.date')}</s-badge>
                <s-link href="https://ec.europa.eu/safety-gate-alerts/screen/pages/gpsr" target="_blank">
                  <s-heading size="small">{t('news.items.gpsr.title')}</s-heading>
                </s-link>
                <s-text tone="subdued" size="small">{t('news.items.gpsr.description')}</s-text>
              </s-stack>
            </s-box>
          </s-grid>
        </s-section>
      )}

      {/* Safety Gate Portal */}
      {visible.calloutCard && (
        <s-section>
          <s-box padding="base" border="base" borderRadius="large" background="bg-surface">
            <s-grid gridTemplateColumns="1fr auto" alignItems="start" gap="base">
              <s-stack gap="small">
                <s-heading size="small">{t('portal.title')}</s-heading>
                <s-text tone="subdued">{t('portal.description') || "Prístup k oficiálnej databáze Safety Gate na vyhľadávanie nebezpečných produktov a detailných upozornení."}</s-text>
                <s-stack direction="inline" gap="small">
                  <s-button variant="primary" href="https://ec.europa.eu/safety-gate-alerts/screen/search?resetSearch=true" target="_blank">
                    {t('portal.searchDatabase')}
                  </s-button>
                  <s-button variant="secondary" href="https://ec.europa.eu/safety-gate-alerts/screen/home" target="_blank">
                    {t('portal.home')}
                  </s-button>
                </s-stack>
              </s-stack>
              <s-button
                onClick={() => setVisible({ ...visible, calloutCard: false })}
                icon="x"
                tone="neutral"
                variant="tertiary"
              />
            </s-grid>
          </s-box>
        </s-section>
      )}
    </s-page>
  );
}
