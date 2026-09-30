import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import {
  getSimilarityThresholdForShop,
  queueShopifyProductChange,
  shopifyProductToProductData,
} from "../services/safety-gate-checker.server";
import { hasCurrentMonitoringEntitlement } from "../services/billing.server";

/** Queue the check durably; processing continues after this webhook returns. */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { payload, topic, shop } = await authenticate.webhook(request);
  if (!(await hasCurrentMonitoringEntitlement(shop))) return new Response(null, { status: 200 });

  const product = payload as Record<string, any>;
  const productId = String(product.id || "");
  const sourceUpdatedAt = String(product.updated_at || product.updatedAt || product.created_at || "");
  if (!productId || !sourceUpdatedAt) {
    console.error(`Cannot queue ${topic} webhook for ${shop}: product identity or version is missing`);
    return new Response("Product identity or version is missing", { status: 422 });
  }

  await queueShopifyProductChange({
    shop,
    productId,
    productTitle: String(product.title || "Untitled product"),
    productHandle: product.handle ? String(product.handle) : undefined,
    sourceUpdatedAt,
    product: shopifyProductToProductData(product),
    similarityThreshold: await getSimilarityThresholdForShop(shop),
  });
  return new Response(null, { status: 202 });
};
