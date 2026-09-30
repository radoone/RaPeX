import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { queueShopifyProductDeletion } from "../services/safety-gate-checker.server";

/** Persist catalog removal and keep its review history available. */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { payload, shop } = await authenticate.webhook(request);
  const product = payload as Record<string, unknown>;
  const productId = String(product.id || "");
  if (!productId) {
    console.error(`Cannot queue products/delete webhook for ${shop}: product identity is missing`);
    return new Response("Product identity is missing", { status: 422 });
  }

  const sourceUpdatedAt = String(product.updated_at || product.updatedAt || "") ||
    request.headers.get("X-Shopify-Triggered-At") || new Date().toISOString();
  await queueShopifyProductDeletion({ shop, productId, sourceUpdatedAt });
  return new Response(null, { status: 202 });
};
