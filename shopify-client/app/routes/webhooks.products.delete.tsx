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

  // The deletion event time is newer than the product's last edit timestamp.
  // Prefer it so a legitimate deletion cannot lose to a queued catalog update.
  const sourceUpdatedAt = request.headers.get("X-Shopify-Triggered-At") ||
    String(product.updated_at || product.updatedAt || "") || new Date().toISOString();
  await queueShopifyProductDeletion({ shop, productId, sourceUpdatedAt });
  return new Response(null, { status: 202 });
};
