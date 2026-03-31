import db from "../merchant-db.server";
import type { ProductData } from "./safety-gate-checker.client";
import {
  checkProductSafety,
  getSimilarityThresholdForShop,
  type SafetyCheckResult,
  shopifyProductToProductData,
  upsertMerchantProductForMonitoring,
} from "./safety-gate-checker.server";

type AdminGraphqlContext = {
  graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response>;
};

type SafetyAlertRecord = {
  id: string;
  productId: string;
  productTitle: string;
  productHandle?: string;
  shop: string;
  checkResult: string;
  status: string;
  riskLevel: string;
  warningsCount: number;
  createdAt: Date;
  updatedAt: Date;
  dismissedAt?: Date | null;
  dismissedBy?: string | null;
  resolvedAt?: Date | null;
  resolutionType?: string | null;
  notes?: string | null;
};

type SafetyCheckRecord = {
  id: string;
  productId: string;
  productTitle: string;
  shop: string;
  isSafe: boolean;
  checkedAt: Date;
  createdAt: Date;
};

export type ProductSafetyState = "unchecked" | "safe" | "unsafe" | "resolved" | "needs-review";

export interface ProductSafetyStatusPayload {
  productId: string;
  state: ProductSafetyState;
  statusMessage: string;
  checkedAt: string | null;
  alertId: string | null;
  alertStatus: string | null;
  alertType: string | null;
  riskLevel: string | null;
  warningsCount: number;
  overallSimilarity: number | null;
  recommendation: string | null;
  resolutionType: string | null;
}

export interface RunProductSafetyCheckResult {
  alertCreated: boolean;
  alertId: string | null;
  result: SafetyCheckResult;
  status: ProductSafetyStatusPayload;
}

function normalizeProductId(rawProductId: string): string {
  const value = rawProductId.trim();
  if (value.startsWith("gid://shopify/Product/")) {
    return value.replace("gid://shopify/Product/", "");
  }
  return value;
}

function toProductGid(rawProductId: string): string {
  return rawProductId.startsWith("gid://")
    ? rawProductId
    : `gid://shopify/Product/${normalizeProductId(rawProductId)}`;
}

function getRiskLevel(result: SafetyCheckResult): string {
  const firstWarning = result.warnings[0];
  return (
    firstWarning?.alertDetails?.fields?.alert_level ||
    firstWarning?.alertDetails?.fields?.risk_level ||
    firstWarning?.riskLevel ||
    "unknown"
  );
}

function getRiskLevelFromResult(result: SafetyCheckResult | null): string | null {
  return result ? getRiskLevel(result) : null;
}

function parseCheckResult(checkResult: string | null | undefined): SafetyCheckResult | null {
  if (!checkResult) {
    return null;
  }

  try {
    return JSON.parse(checkResult) as SafetyCheckResult;
  } catch {
    return null;
  }
}

function getAlertType(result: SafetyCheckResult | null): string | null {
  const firstWarning = result?.warnings?.[0];
  return (
    firstWarning?.alertType ||
    firstWarning?.alertDetails?.fields?.alert_type ||
    null
  );
}

function getOverallSimilarity(result: SafetyCheckResult | null): number | null {
  const value = result?.warnings?.[0]?.overallSimilarity;
  return Number.isFinite(value) ? value : null;
}

function isoOrNull(value: Date | null | undefined): string | null {
  return value instanceof Date ? value.toISOString() : null;
}

function buildStatusPayload(input: {
  productId: string;
  activeAlert: SafetyAlertRecord | null;
  latestAlert: SafetyAlertRecord | null;
  latestCheck: SafetyCheckRecord | null;
}): ProductSafetyStatusPayload {
  const { productId, activeAlert, latestAlert, latestCheck } = input;
  const activeResult = parseCheckResult(activeAlert?.checkResult);
  const latestAlertResult = parseCheckResult(latestAlert?.checkResult);

  if (activeAlert) {
    return {
      productId,
      state: "unsafe",
      statusMessage: "Potential Safety Gate match detected.",
      checkedAt: isoOrNull(latestCheck?.checkedAt) ?? isoOrNull(activeAlert.updatedAt),
      alertId: activeAlert.id,
      alertStatus: activeAlert.status,
      alertType: getAlertType(activeResult),
      riskLevel: activeAlert.riskLevel || getRiskLevelFromResult(activeResult),
      warningsCount: activeAlert.warningsCount,
      overallSimilarity: getOverallSimilarity(activeResult),
      recommendation: activeResult?.recommendation ?? null,
      resolutionType: activeAlert.resolutionType ?? null,
    };
  }

  if (latestCheck?.isSafe) {
    return {
      productId,
      state: "safe",
      statusMessage: "Last Safety Gate check found no likely match.",
      checkedAt: isoOrNull(latestCheck.checkedAt),
      alertId: null,
      alertStatus: null,
      alertType: null,
      riskLevel: null,
      warningsCount: 0,
      overallSimilarity: null,
      recommendation: null,
      resolutionType: null,
    };
  }

  if (latestAlert && latestAlert.status !== "active") {
    return {
      productId,
      state: "resolved",
      statusMessage:
        latestAlert.status === "dismissed"
          ? "Previous Safety Gate alert was dismissed."
          : "Previous Safety Gate alert was resolved.",
      checkedAt: isoOrNull(latestCheck?.checkedAt) ?? isoOrNull(latestAlert.updatedAt),
      alertId: latestAlert.id,
      alertStatus: latestAlert.status,
      alertType: getAlertType(latestAlertResult),
      riskLevel: latestAlert.riskLevel || null,
      warningsCount: latestAlert.warningsCount,
      overallSimilarity: getOverallSimilarity(latestAlertResult),
      recommendation: latestAlertResult?.recommendation ?? null,
      resolutionType: latestAlert.resolutionType ?? null,
    };
  }

  if (latestCheck) {
    return {
      productId,
      state: "needs-review",
      statusMessage: "Last check found a likely match. Review the latest result.",
      checkedAt: isoOrNull(latestCheck.checkedAt),
      alertId: null,
      alertStatus: null,
      alertType: null,
      riskLevel: null,
      warningsCount: 0,
      overallSimilarity: null,
      recommendation: null,
      resolutionType: null,
    };
  }

  return {
    productId,
    state: "unchecked",
    statusMessage: "This product has not been checked against Safety Gate yet.",
    checkedAt: null,
    alertId: null,
    alertStatus: null,
    alertType: null,
    riskLevel: null,
    warningsCount: 0,
    overallSimilarity: null,
    recommendation: null,
    resolutionType: null,
  };
}

async function fetchLatestSafetyRecords(shop: string, productId: string) {
  const normalizedProductId = normalizeProductId(productId);
  const [activeAlert, latestAlertRows, latestCheckRows] = await Promise.all([
    db.safetyAlert.findFirst({
      where: { shop, productId: normalizedProductId, status: "active" },
      orderBy: { updatedAt: "desc" },
    }),
    db.safetyAlert.findMany({
      where: { shop, productId: normalizedProductId },
      orderBy: { updatedAt: "desc" },
      take: 1,
    }),
    db.safetyCheck.findMany({
      where: { shop, productId: normalizedProductId },
      orderBy: { checkedAt: "desc" },
      take: 1,
    }),
  ]);

  return {
    productId: normalizedProductId,
    activeAlert: (activeAlert as SafetyAlertRecord | null) ?? null,
    latestAlert: (latestAlertRows[0] as SafetyAlertRecord | undefined) ?? null,
    latestCheck: (latestCheckRows[0] as SafetyCheckRecord | undefined) ?? null,
  };
}

export async function getProductSafetyStatus(shop: string, productId: string): Promise<ProductSafetyStatusPayload> {
  const records = await fetchLatestSafetyRecords(shop, productId);
  return buildStatusPayload(records);
}

export async function runProductSafetyCheck(input: {
  shop: string;
  productId: string;
  productTitle: string;
  productHandle?: string;
  productData: ProductData;
  sourceUpdatedAt?: string;
}): Promise<RunProductSafetyCheckResult> {
  const productId = normalizeProductId(input.productId);
  const threshold = await getSimilarityThresholdForShop(input.shop);
  const safetyResult = await checkProductSafety(input.productData, threshold);

  await upsertMerchantProductForMonitoring({
    shop: input.shop,
    productId,
    productTitle: input.productTitle,
    productHandle: input.productHandle,
    product: input.productData,
    sourceUpdatedAt: input.sourceUpdatedAt,
  });

  let alertId: string | null = null;
  let alertCreated = false;

  if (!safetyResult.isSafe && safetyResult.warnings.length > 0) {
    const riskLevel = getRiskLevel(safetyResult);
    const existingActiveAlert = await db.safetyAlert.findFirst({
      where: { shop: input.shop, productId, status: "active" },
    });

    if (existingActiveAlert) {
      const updated = await db.safetyAlert.update({
        where: { id: existingActiveAlert.id },
        data: {
          checkResult: JSON.stringify(safetyResult),
          riskLevel,
          warningsCount: safetyResult.warnings.length,
          status: "active",
          resolvedAt: null,
          dismissedAt: null,
          dismissedBy: null,
          resolutionType: null,
          notes: null,
        },
      });
      alertId = updated.id;
    } else {
      const created = await db.safetyAlert.create({
        data: {
          productId,
          productTitle: input.productTitle,
          productHandle: input.productHandle,
          shop: input.shop,
          checkResult: JSON.stringify(safetyResult),
          status: "active",
          riskLevel,
          warningsCount: safetyResult.warnings.length,
        },
      });
      alertId = created.id;
      alertCreated = true;
    }
  } else {
    const existingActiveAlert = await db.safetyAlert.findFirst({
      where: { shop: input.shop, productId, status: "active" },
    });

    if (existingActiveAlert) {
      const resolved = await db.safetyAlert.update({
        where: { id: existingActiveAlert.id },
        data: {
          status: "resolved",
          resolvedAt: new Date(),
          notes: "Manual re-check marked product as safe.",
        },
      });
      alertId = resolved.id;
    }
  }

  await db.safetyCheck.create({
    data: {
      productId,
      productTitle: input.productTitle,
      shop: input.shop,
      isSafe: safetyResult.isSafe,
      checkedAt: new Date(safetyResult.checkedAt),
    },
  });

  const status = await getProductSafetyStatus(input.shop, productId);

  return {
    alertCreated,
    alertId,
    result: safetyResult,
    status,
  };
}

export async function runProductSafetyCheckForAdminProduct(input: {
  admin: AdminGraphqlContext;
  shop: string;
  productId: string;
}): Promise<RunProductSafetyCheckResult> {
  const productGid = toProductGid(input.productId);
  const response = await input.admin.graphql(
    `#graphql
      query ProductSafetyCheck($id: ID!) {
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
          images(first: 4) {
            nodes {
              url
              altText
            }
          }
          variants(first: 5) {
            edges {
              node {
                id
                title
                price
                image {
                  url
                }
              }
            }
          }
          updatedAt
        }
      }
    `,
    { variables: { id: productGid } },
  );

  const payload = await response.json();
  const product = payload.data?.product;

  if (!product) {
    throw new Error("Product not found in Shopify Admin API");
  }

  return runProductSafetyCheck({
    shop: input.shop,
    productId: product.id,
    productTitle: product.title,
    productHandle: product.handle || undefined,
    productData: shopifyProductToProductData(product),
    sourceUpdatedAt: product.updatedAt || undefined,
  });
}
