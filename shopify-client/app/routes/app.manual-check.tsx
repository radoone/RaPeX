import { useState, useCallback, useEffect } from "react";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { useLoaderData, useFetcher } from "@remix-run/react";
import { json } from "@remix-run/node";
import {
  Page,
  Layout,
  Card,
  Text,
  Button,
  BlockStack,
  InlineStack,
  InlineGrid,
  Badge,
  DataTable,
  EmptyState,
  Banner,
  Modal,
  Icon,
  Divider,
  ProgressBar,
  Thumbnail,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { shopifyProductToProductData } from "../services/safety-gate-checker.client";
import prisma from "../db.server";
import { AlertBadge, SafetyGatePortal, AlertDetailModal } from "../components";
import {
  ClipboardChecklistIcon,
  AlertDiamondIcon,
  CheckCircleIcon,
  ClockIcon,
  ProductIcon,
  RefreshIcon,
  ViewIcon,
} from "@shopify/polaris-icons";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);

  // Get recent products from Shopify
  const productsResponse = await admin.graphql(`
    query getProducts($first: Int!) {
      products(first: $first, sortKey: UPDATED_AT, reverse: true) {
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
            featuredImage {
              url
              altText
            }
            variants(first: 5) {
              edges {
                node {
                  id
                  title
                  selectedOptions {
                    name
                    value
                  }
                  image {
                    url
                    altText
                  }
                  price
                }
              }
            }
            updatedAt
            createdAt
          }
        }
      }
    }
  `, {
    variables: { first: 50 }
  });

  const productsJson = await productsResponse.json();
  const products = productsJson.data?.products?.edges?.map((edge: any) => edge.node) || [];

  // Get safety check history for all products
  const productIds = products.map((p: any) => p.id.replace('gid://shopify/Product/', ''));
  const productChecks = await (prisma as any).safetyCheck.findMany({
    where: {
      shop: session.shop,
      productId: {
        in: productIds,
      },
    },
    orderBy: {
      checkedAt: 'desc',
    },
  });

  // Group checks by product ID and calculate stats
  const checksByProduct = productChecks.reduce((acc: any, check: any) => {
    if (!acc[check.productId]) {
      acc[check.productId] = {
        checks: [],
        totalChecks: 0,
        lastCheck: null,
        isSafe: null,
        safeCount: 0,
        unsafeCount: 0,
      };
    }
    acc[check.productId].checks.push(check);
    acc[check.productId].totalChecks++;
    if (!acc[check.productId].lastCheck || check.checkedAt > acc[check.productId].lastCheck.checkedAt) {
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

  return json({
    products,
    checksByProduct,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const action = formData.get("action") as string;

  if (action === "checkProduct") {
    const productData = JSON.parse(formData.get("productData") as string);
    const productId = formData.get("productId") as string;
    const productTitle = formData.get("productTitle") as string;

    try {
      // Import the server function dynamically to avoid client-side issues
      const { checkProductSafety } = await import("../services/safety-gate-checker.server");
      const safetyResult = await checkProductSafety(productData);

      // Debug logging
      console.log('Safety check result:', {
        isSafe: safetyResult.isSafe,
        warningsCount: safetyResult.warnings.length
      });

      // Store check result
      if (!safetyResult.isSafe && safetyResult.warnings.length > 0) {
        // Check if alert already exists
        const existingAlert = await (prisma as any).safetyAlert.findFirst({
          where: {
            productId: productId,
            shop: session.shop,
            status: 'active',
          },
        });

        if (!existingAlert) {
          await (prisma as any).safetyAlert.create({
            data: {
              productId: productId,
              productTitle: productTitle,
              shop: session.shop,
              checkResult: JSON.stringify(safetyResult),
              status: 'active',
              riskLevel: safetyResult.warnings[0]?.riskLevel || 'unknown',
              warningsCount: safetyResult.warnings.length,
            },
          });
        }
      }

      // Log the check
      await (prisma as any).safetyCheck.create({
        data: {
          productId: productId,
          productTitle: productTitle,
          shop: session.shop,
          isSafe: safetyResult.isSafe,
          checkedAt: new Date(safetyResult.checkedAt),
        },
      });

      return json({
        success: true,
        result: safetyResult,
        alertCreated: !safetyResult.isSafe && safetyResult.warnings.length > 0
      });

    } catch (error) {
      console.error("Manual check error:", error);
      return json({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  if (action === "recheckProduct") {
    const productId = formData.get("productId") as string;
    const productTitle = formData.get("productTitle") as string;

    try {
      // Fetch current product data from Shopify
      const productResponse = await admin.graphql(`
        query getProduct($id: ID!) {
          product(id: $id) {
            id
            title
            handle
            vendor
            productType
            tags
            description
            descriptionHtml
            featuredImage {
              url
              altText
            }
            variants(first: 5) {
              edges {
                node {
                  id
                  title
                  selectedOptions {
                    name
                    value
                  }
                  image {
                    url
                    altText
                  }
                  price
                }
              }
            }
            updatedAt
            createdAt
          }
        }
      `, {
        variables: { id: `gid://shopify/Product/${productId}` }
      });

      const productJson = await productResponse.json();
      const product = productJson.data?.product;

      if (!product) {
        return json({
          success: false,
          error: 'Product not found in Shopify'
        });
      }

      // Import the client function to convert product data
      const { shopifyProductToProductData } = await import("../services/safety-gate-checker.client");
      const productData = shopifyProductToProductData(product);

      // Import the server function to check safety
      const { checkProductSafety } = await import("../services/safety-gate-checker.server");
      const safetyResult = await checkProductSafety(productData);

      // Store check result
      if (!safetyResult.isSafe && safetyResult.warnings.length > 0) {
        // Check if alert already exists
        const existingAlert = await (prisma as any).safetyAlert.findFirst({
          where: {
            productId: productId,
            shop: session.shop,
            status: 'active',
          },
        });

        if (!existingAlert) {
          await (prisma as any).safetyAlert.create({
            data: {
              productId: productId,
              productTitle: productTitle,
              shop: session.shop,
              checkResult: JSON.stringify(safetyResult),
              status: 'active',
              riskLevel: safetyResult.warnings[0]?.riskLevel || 'unknown',
              warningsCount: safetyResult.warnings.length,
            },
          });
        }
      }

      // Log the check
      await (prisma as any).safetyCheck.create({
        data: {
          productId: productId,
          productTitle: productTitle,
          shop: session.shop,
          isSafe: safetyResult.isSafe,
          checkedAt: new Date(safetyResult.checkedAt),
        },
      });

      return json({
        success: true,
        result: safetyResult,
        alertCreated: !safetyResult.isSafe && safetyResult.warnings.length > 0
      });

    } catch (error) {
      console.error("Recheck product error:", error);
      return json({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
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
  const [selectedProductHistory, setSelectedProductHistory] = useState<any>(null);
  const [showHistoryModal, setShowHistoryModal] = useState(false);

  const productCheckEntries = Object.values(checksByProduct || {});
  const checkedProducts = productCheckEntries.filter((entry: any) => entry.totalChecks > 0).length;
  const unsafeProducts = productCheckEntries.filter((entry: any) => entry.isSafe === false).length;
  const totalManualChecks = productCheckEntries.reduce((sum: number, entry: any) => sum + entry.totalChecks, 0);
  const coverageRate = products.length > 0
    ? Math.round((checkedProducts / products.length) * 100)
    : 0;

  const statCards = [
    {
      id: 'catalog' as const,
      title: 'Products in scope',
      value: products.length,
      description: 'Latest products pulled from your Shopify store.',
      icon: ProductIcon,
      background: 'bg-surface-secondary' as const,
      badge: undefined as string | undefined,
      badgeTone: undefined as 'success' | 'critical' | undefined,
      progress: undefined as number | undefined,
      progressTone: undefined as 'success' | 'primary' | undefined,
      progressLabel: undefined as string | undefined,
    },
    {
      id: 'checks' as const,
      title: 'Manual checks completed',
      value: totalManualChecks,
      description: checkedProducts > 0
        ? `${checkedProducts} products have at least one manual scan.`
        : 'Run your first manual scan to create a compliance trail.',
      icon: ClipboardChecklistIcon,
      background: 'bg-surface-emphasis' as const,
      badge: undefined as string | undefined,
      badgeTone: undefined as 'success' | 'critical' | undefined,
      progress: coverageRate,
      progressTone: (coverageRate === 100 ? 'success' : 'primary') as 'success' | 'primary',
      progressLabel: products.length > 0 ? `${coverageRate}% of listed products checked` : undefined,
    },
    {
      id: 'unsafe' as const,
      title: 'Products needing review',
      value: unsafeProducts,
      description: unsafeProducts === 0
        ? 'No manual checks have flagged outstanding risks.'
        : 'Resolve flagged items before fulfilling new orders.',
      icon: AlertDiamondIcon,
      background: (unsafeProducts > 0 ? 'bg-surface-critical' : 'bg-surface-success') as 'bg-surface-critical' | 'bg-surface-success',
      badge: unsafeProducts === 0 ? 'All clear' : `${unsafeProducts} flagged`,
      badgeTone: (unsafeProducts === 0 ? 'success' : 'critical') as 'success' | 'critical',
      progress: undefined as number | undefined,
      progressTone: undefined as 'success' | 'primary' | undefined,
      progressLabel: undefined as string | undefined,
    },
  ];

  const handleProductCheck = useCallback((product: any) => {
    const productData = shopifyProductToProductData(product);

    fetcher.submit({
      action: "checkProduct",
      productData: JSON.stringify(productData),
      productId: product.id.replace('gid://shopify/Product/', ''),
      productTitle: product.title,
    }, { method: "POST" });

    setSelectedProduct(product);
    setHasProcessedResult(false); // Reset flag for new check
  }, [fetcher]);



  const showProductHistory = useCallback((productId: string) => {
    const product = products.find((p: any) => p.id.replace('gid://shopify/Product/', '') === productId);
    const productChecks = checksByProduct[productId];

    if (product && productChecks) {
      setSelectedProductHistory({
        product,
        checks: productChecks.checks,
      });
      setShowHistoryModal(true);
    }
  }, [products, checksByProduct]);

  const isLoading = fetcher.state === 'submitting';

  // Handle fetcher result
  useEffect(() => {
    if (fetcher.data && 'success' in fetcher.data && fetcher.data.success && !showResult && !hasProcessedResult) {
      setCheckResult((fetcher.data as any).result);
      setShowResult(true);
      setHasProcessedResult(true);
    }
  }, [fetcher.data, showResult, hasProcessedResult]);



  const handleCloseModal = () => {
    setShowResult(false);
    setCheckResult(null);
    setSelectedProduct(null);
    // Don't reset hasProcessedResult to prevent modal from reopening
  };

  return (
    <Page>
      <TitleBar title="Manual Product Safety Check" />

      {fetcher.data && 'error' in fetcher.data && fetcher.data.error && (
        <Banner
          title="Manual check failed"
          tone="critical"
          icon={AlertDiamondIcon}
        >
          <p>{(fetcher.data as any).error}</p>
          <p>Please try again or run the bulk checker from the dashboard.</p>
        </Banner>
      )}

      {fetcher.data && 'alertCreated' in fetcher.data && fetcher.data.alertCreated && (
        <Banner
          title="Safety alert created"
          tone="critical"
          icon={AlertDiamondIcon}
          action={{
            content: 'Review alerts',
            url: '/app',
          }}
        >
          <p>A safety alert has been logged for this product due to potential risks.</p>
        </Banner>
      )}

      <Layout>
        <Layout.Section>
          <BlockStack gap="500">
            <Card background="bg-surface-secondary" padding="400" roundedAbove="sm">
              <BlockStack gap="300">
                <InlineStack align="space-between" blockAlign="center">
                  <BlockStack gap="200">
                    <Text as="h1" variant="headingLg">
                      Manual product safety check
                    </Text>
                    <Text as="p" tone="subdued">
                      Run on-demand scans before launching new products or after supplier updates.
                    </Text>
                  </BlockStack>
                  <InlineStack gap="200">
                    <Button
                      variant="primary"
                      icon={AlertDiamondIcon}
                      url="/app"
                    >
                      View active alerts
                    </Button>
                    <Button
                      variant="secondary"
                      icon={ClipboardChecklistIcon}
                      target="_blank"
                      url="https://ec.europa.eu/safety-gate-alerts/screen/search?resetSearch=true"
                    >
                      Safety Gate search
                    </Button>
                  </InlineStack>
                </InlineStack>
              </BlockStack>
            </Card>

            <InlineGrid columns={{ xs: 1, md: 3 }} gap="400">
              {statCards.map((stat) => (
                <Card key={stat.id} background={stat.background} padding="400" roundedAbove="sm">
                  <BlockStack gap="300">
                    <InlineStack align="space-between" blockAlign="center">
                      <Icon
                        source={stat.icon}
                        tone={stat.id === 'unsafe' ? (unsafeProducts > 0 ? 'critical' : 'success') : 'primary'}
                      />
                      {stat.badge && (
                        <Badge tone={stat.badgeTone}>{stat.badge}</Badge>
                      )}
                    </InlineStack>
                    <Text as="p" variant="heading2xl">
                      {stat.value.toLocaleString()}
                    </Text>
                    <Text as="p" tone="subdued">
                      {stat.description}
                    </Text>
                    {stat.progress !== undefined && (
                      <BlockStack gap="200">
                        <ProgressBar progress={stat.progress} tone={stat.progressTone ?? 'primary'} />
                        {stat.progressLabel && (
                          <Text as="p" variant="bodySm" tone="subdued">
                            {stat.progressLabel}
                          </Text>
                        )}
                      </BlockStack>
                    )}
                  </BlockStack>
                </Card>
              ))}
            </InlineGrid>

            <Card padding="400" roundedAbove="sm">
              <BlockStack gap="300">
                <InlineStack align="space-between" blockAlign="center">
                  <BlockStack gap="100">
                    <Text as="h2" variant="headingMd">
                      Product safety overview ({products.length} products)
                    </Text>
                    <Text as="p" tone="subdued">
                      Select a product to run a manual cross-check against the Safety Gate database.
                    </Text>
                  </BlockStack>
                  <Badge tone={unsafeProducts > 0 ? 'critical' : 'success'}>
                    {unsafeProducts > 0 ? `${unsafeProducts} products flagged` : 'All clear'}
                  </Badge>
                </InlineStack>
                <Divider />
                {products.length === 0 ? (
                  <EmptyState
                    heading="No products found"
                    image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                  >
                    <p>No products are available for checking.</p>
                  </EmptyState>
                ) : (
                  <DataTable
                    columnContentTypes={['text', 'text', 'text', 'text', 'text', 'text']}
                    headings={['Product', 'Status', 'Checks', 'Last check', 'Updated', 'Actions']}
                    rows={products.map((product: any) => {
                      const productId = product.id.replace('gid://shopify/Product/', '');
                      const productChecks = checksByProduct[productId] || {
                        totalChecks: 0,
                        lastCheck: null,
                        isSafe: null,
                        safeCount: 0,
                        unsafeCount: 0,
                      };

                      const lastCheck = productChecks.lastCheck;
                      const lastCheckDate = lastCheck ? new Date(lastCheck.checkedAt) : null;
                      const updatedAt = new Date(product.updatedAt);
                      const safeProgress = productChecks.totalChecks > 0
                        ? Math.round((productChecks.safeCount / productChecks.totalChecks) * 100)
                        : 0;

                      const statusBadge = lastCheck ? (
                        <Badge
                          tone={productChecks.isSafe ? 'success' : 'critical'}
                          icon={productChecks.isSafe ? CheckCircleIcon : AlertDiamondIcon}
                        >
                          {productChecks.isSafe ? 'Safe' : 'Unsafe'}
                        </Badge>
                      ) : (
                        <Badge tone="info" icon={ClockIcon}>Not checked</Badge>
                      );

                      const checksCell = productChecks.totalChecks > 0 ? (
                        <BlockStack gap="100">
                          <Text as="span" variant="bodyMd">{productChecks.totalChecks} total</Text>
                          <ProgressBar
                            progress={safeProgress}
                            tone={productChecks.unsafeCount > 0 ? 'critical' : 'success'}
                          />
                          <InlineStack gap="100" wrap>
                            {productChecks.safeCount > 0 && (
                              <Badge tone="success">{`${productChecks.safeCount} safe`}</Badge>
                            )}
                            {productChecks.unsafeCount > 0 && (
                              <Badge tone="critical">{`${productChecks.unsafeCount} unsafe`}</Badge>
                            )}
                          </InlineStack>
                        </BlockStack>
                      ) : (
                        <Text as="span" variant="bodySm" tone="subdued">
                          No manual checks yet
                        </Text>
                      );

                      const lastCheckCell = lastCheckDate ? (
                        <BlockStack gap="100">
                          <Text as="span" variant="bodyMd">
                            {lastCheckDate.toLocaleDateString('en-GB')}
                          </Text>
                          <Text as="span" variant="bodySm" tone="subdued">
                            {lastCheckDate.toLocaleTimeString('en-GB')}
                          </Text>
                        </BlockStack>
                      ) : (
                        <Text as="span" variant="bodySm" tone="subdued">Never</Text>
                      );

                      const updatedCell = (
                        <BlockStack gap="100">
                          <Text as="span" variant="bodyMd">
                            {updatedAt.toLocaleDateString('en-GB')}
                          </Text>
                          <Text as="span" variant="bodySm" tone="subdued">
                            {updatedAt.toLocaleTimeString('en-GB')}
                          </Text>
                        </BlockStack>
                      );

                      return [
                        <InlineStack key={`product-${product.id}`} gap="200" blockAlign="center">
                          <Thumbnail
                            size="small"
                            source={product.featuredImage?.url || ProductIcon}
                            alt={product.featuredImage?.altText || product.title}
                          />
                          <BlockStack gap="100">
                            <Text as="span" variant="bodyMd" fontWeight="semibold">
                              {product.title}
                            </Text>
                            <Text as="span" variant="bodySm" tone="subdued">
                              {(product.vendor || 'Unknown vendor')} · {(product.productType || 'No type')}
                            </Text>
                          </BlockStack>
                        </InlineStack>,
                        statusBadge,
                        checksCell,
                        lastCheckCell,
                        updatedCell,
                        <InlineStack key={`actions-${product.id}`} gap="200">
                          <Button
                            size="micro"
                            variant="primary"
                            icon={ClipboardChecklistIcon}
                            loading={isLoading && selectedProduct?.id === product.id}
                            onClick={() => handleProductCheck(product)}
                          >
                            {productChecks.totalChecks > 0 ? 'Check again' : 'Check safety'}
                          </Button>
                          {productChecks.totalChecks > 0 && (
                            <Button
                              size="micro"
                              variant="secondary"
                              icon={ClockIcon}
                              onClick={() => showProductHistory(productId)}
                            >
                              History
                            </Button>
                          )}
                        </InlineStack>,
                      ];
                    })}
                  />
                )}
              </BlockStack>
            </Card>
          </BlockStack>
        </Layout.Section>
      </Layout>

      <Layout>
        <Layout.Section variant="fullWidth">
          <BlockStack gap="400">
            <Card padding="400" roundedAbove="sm">
              <BlockStack gap="300">
                <InlineStack gap="200" blockAlign="center">
                  <Icon source={CheckCircleIcon} tone="success" />
                  <Text as="h2" variant="headingMd">
                    Manual check tips
                  </Text>
                </InlineStack>
                <BlockStack gap="200">
                  <InlineStack gap="200" blockAlign="start">
                    <Icon source={ClipboardChecklistIcon} tone="primary" />
                    <Text as="p" variant="bodyMd">
                      Validate new suppliers and restocks before publishing listings.
                    </Text>
                  </InlineStack>
                  <InlineStack gap="200" blockAlign="start">
                    <Icon source={AlertDiamondIcon} tone="critical" />
                    <Text as="p" variant="bodyMd">
                      Investigate any unsafe results and document your remediation steps.
                    </Text>
                  </InlineStack>
                  <InlineStack gap="200" blockAlign="start">
                    <Icon source={RefreshIcon} tone="primary" />
                    <Text as="p" variant="bodyMd">
                      Re-run checks after updating product data or receiving new variants.
                    </Text>
                  </InlineStack>
                </BlockStack>
              </BlockStack>
            </Card>

            <SafetyGatePortal />
          </BlockStack>
        </Layout.Section>
      </Layout>
      {/* Results Modal */}
      {checkResult && (
        <AlertDetailModal
          open={showResult}
          onClose={handleCloseModal}
          alert={{
            productTitle: selectedProduct?.title || 'Unknown Product',
            productImage: selectedProduct?.featuredImage?.url || null,
            riskLevel: checkResult.warnings?.[0]?.riskLevel || checkResult.warnings?.[0]?.alertDetails?.fields?.risk_level || 'Unknown',
            alertType: checkResult.warnings?.[0]?.alertType || checkResult.warnings?.[0]?.alertDetails?.fields?.alert_type || 'Unknown',
            riskDescription: checkResult.warnings?.[0]?.riskLegalProvision || checkResult.warnings?.[0]?.alertDetails?.fields?.risk_legal_provision || '',
            status: checkResult.isSafe ? 'resolved' : 'active',
            warningsCount: checkResult.warnings?.length || 0,
            checkResult: JSON.stringify({
              ...checkResult,
              warnings: checkResult.warnings?.map((w: any) => ({
                ...w,
                alertDetails: {
                  ...w.alertDetails,
                  fields: {
                    ...w.alertDetails?.fields,
                    pictures: (w.alertDetails?.fields?.pictures?.length > 0)
                      ? w.alertDetails.fields.pictures
                      : ['https://via.placeholder.com/150']
                  }
                }
              })) || []
            }),
            notes: null
          }}
        />
      )}
      {/* Product History Modal */}
      {selectedProductHistory && (
        <Modal
          open={showHistoryModal}
          onClose={() => setShowHistoryModal(false)}
          title={`Safety Check History: ${selectedProductHistory.product.title}`}
          size="large"
        >
          <Modal.Section>
            <BlockStack gap="400">
              <Text as="h3" variant="headingMd">All Safety Checks</Text>

              {selectedProductHistory.checks.length === 0 ? (
                <Text as="p">No safety checks found for this product.</Text>
              ) : (
                <DataTable
                  columnContentTypes={['text', 'text', 'text']}
                  headings={['Date & Time', 'Result', 'Details']}
                  rows={selectedProductHistory.checks.map((check: any, index: number) => [
                    <BlockStack key={`history-date-${index}`} gap="100">
                      <Text as="span" variant="bodyMd">
                        {new Date(check.checkedAt).toLocaleDateString('en-GB')}
                      </Text>
                      <Text as="span" variant="bodySm">
                        {new Date(check.checkedAt).toLocaleTimeString()}
                      </Text>
                    </BlockStack>,
                    <Badge
                      key={`history-status-${index}`}
                      tone={check.isSafe ? "success" : "critical"}
                    >
                      {check.isSafe ? "Safe" : "Unsafe"}
                    </Badge>,
                    <Button
                      key={`history-details-${index}`}
                      size="micro"
                      variant="secondary"
                      icon={ViewIcon}
                      onClick={() => {
                        // Show detailed results for this specific check
                        setSelectedProduct(selectedProductHistory.product);
                        setCheckResult(check);
                        setShowResult(true);
                        setShowHistoryModal(false);
                      }}
                    >
                      View Details
                    </Button>
                  ])}
                />
              )}
            </BlockStack>
          </Modal.Section>
        </Modal>
      )}
    </Page >
  );
}
