import { useEffect, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useFetcher, useLoaderData, useNavigation, useNavigate, json } from "@remix-run/react";
import { useTranslation } from "react-i18next";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { SummaryCard } from "../components";
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

  const [activeAlerts, totalAlerts, resolvedAlerts, dismissedAlerts, totalChecks, recentAlerts, checkedProductIds, activeAlertRiskSample] = await Promise.all([
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
    db.safetyAlert.findMany({
      where: { shop: session.shop, status: 'active' },
      select: { riskLevel: true, checkResult: true },
      take: 100,
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
  const criticalActiveAlerts = activeAlertRiskSample.filter((alert: any) => {
    try {
      const parsed = alert.checkResult ? JSON.parse(alert.checkResult) : null;
      const warning = Array.isArray(parsed?.warnings) ? parsed.warnings[0] : null;
      const level = String(
        warning?.alertDetails?.fields?.alert_level ||
        warning?.alertDetails?.fields?.risk_level ||
        warning?.riskLevel ||
        alert.riskLevel ||
        ""
      ).toLowerCase();
      return level.includes("serious") || level.includes("high") || level === "1" || level === "2";
    } catch {
      const level = String(alert.riskLevel || "").toLowerCase();
      return level.includes("serious") || level.includes("high") || level === "1" || level === "2";
    }
  }).length;

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
      criticalActiveAlerts,
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
                  images(first: 4) { nodes { url altText } }
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
  const [includeAlreadyChecked] = useState(false);

  const isLoading = navigation.state === "loading";
  const isSubmitting = fetcher.state === "submitting";
  const coverageRate = stats.totalProducts > 0 ? Math.round((stats.checkedProducts / stats.totalProducts) * 100) : 0;
  const runBulkCheck = () => {
    if (isSubmitting) return;
    fetcher.submit(
      { action: "bulkCheck", includeAlreadyChecked: includeAlreadyChecked.toString() },
      { method: "POST" },
    );
  };

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
    <s-page size="large" className="page-shell">
      <s-heading slot="title" size="large">{t('nav.dashboard')}</s-heading>
      <s-button
        slot="primary-action"
        variant="primary"
        loading={isSubmitting || undefined}
        onClick={runBulkCheck}
        disabled={stats.uncheckedProducts === 0 && !includeAlreadyChecked || undefined}
      >
        {isSubmitting
          ? t('actions.checking')
          : t('actions.checkUnchecked', { count: stats.uncheckedProducts })}
      </s-button>

      <div className="admin-stack">
        {stats.activeAlerts > 0 && (
          <s-banner
            tone={stats.criticalActiveAlerts > 0 ? "critical" : "warning"}
            heading={stats.criticalActiveAlerts > 0
              ? t("dashboard.admin.criticalBannerTitle", { count: stats.activeAlerts })
              : t("dashboard.admin.warningBannerTitle", { count: stats.activeAlerts })}
          >
            <s-text>
              {stats.criticalActiveAlerts > 0
                ? t("dashboard.admin.criticalBannerDescription", { count: stats.criticalActiveAlerts })
                : t("dashboard.admin.warningBannerDescription")}
            </s-text>
            <div style={{ marginTop: "var(--s-space-200)" }}>
              <s-button variant="primary" onClick={() => navigate("/app/alerts?status=active")}>
                {t("actions.reviewAlerts")}
              </s-button>
            </div>
          </s-banner>
        )}

        <section className="metric-grid">
          <SummaryCard
            title={t("dashboard.stats.activeAlerts")}
            value={stats.activeAlerts}
            badge={<s-badge tone={stats.activeAlerts > 0 ? "critical" : "success"}>{stats.activeAlerts > 0 ? t("status.needsReview") : t("status.allClear")}</s-badge>}
            description={t("dashboard.admin.activeAlertsDescription")}
          />
          <SummaryCard
            title={t("dashboard.admin.catalogCoverageTitle")}
            value={`${coverageRate}%`}
            badge={<s-badge tone="info">{stats.checkedProducts}/{stats.totalProducts || 0} {t("dashboard.admin.stats.totalProducts").toLowerCase()}</s-badge>}
            description={t("dashboard.admin.catalogCoverageDescription")}
            progress={coverageRate}
            progressTone="primary"
          />
          <SummaryCard
            title={t("dashboard.admin.checksCompletedTitle")}
            value={stats.totalChecks}
            badge={<s-badge tone="success">{t("dashboard.stats.autoMonitoring")}</s-badge>}
            description={t("dashboard.admin.checksCompletedDescription")}
          />
        </section>

        <section className="admin-card">
          <div className="admin-card__header">
            <div>
              <p className="admin-eyebrow">{t("dashboard.admin.priorityQueue")}</p>
              <h2 className="admin-card__title">{t("dashboard.admin.recentAlertsTitle")}</h2>
              <p className="admin-card__description">
                {t("dashboard.admin.recentAlertsDescription")}
              </p>
            </div>
            <s-button variant="secondary" onClick={() => navigate("/app/alerts")}>
              {t("actions.viewAlerts")}
            </s-button>
          </div>

          {recentAlerts.length === 0 ? (
            <div className="admin-empty-state">
              <h3>{t("dashboard.admin.noAlertsTitle")}</h3>
              <p>{t("dashboard.admin.noAlertsDescription")}</p>
            </div>
          ) : (
            <div className="admin-alert-list">
              {recentAlerts.map((alert) => (
                <div className="admin-alert-row" key={alert.id}>
                  <div className="admin-alert-row__media">
                    {alert.productImage ? (
                      <img src={alert.productImage} alt={alert.productTitle} className="admin-alert-row__image" />
                    ) : (
                      <div className="admin-alert-row__placeholder">!</div>
                    )}
                  </div>
                  <div className="admin-alert-row__content">
                    <div className="admin-alert-row__meta">
                      <h3>{alert.productTitle}</h3>
                      <p>{alert.riskDescription || t("dashboard.admin.fallbackAlertDescription")}</p>
                    </div>
                    <div className="admin-inline-meta">
                      <s-badge tone={alert.status === "active" ? "critical" : alert.status === "resolved" ? "success" : "info"}>
                        {alert.status === "active"
                          ? t("status.needsReview")
                          : alert.status === "resolved"
                            ? t("status.resolved")
                            : t("status.dismissed")}
                      </s-badge>
                      {alert.alertType && <s-badge tone="warning">{alert.alertType}</s-badge>}
                    </div>
                  </div>
                  <div className="admin-alert-row__actions">
                    <s-button variant="secondary" onClick={() => navigate("/app/alerts")}>
                      {t("actions.view")}
                    </s-button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </s-page>
  );
}
