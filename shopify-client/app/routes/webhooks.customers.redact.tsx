import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";

/**
 * GDPR webhook: customers/redact
 * Shopify sends this when a store owner requests deletion of customer data.
 * Since this app doesn't store personal customer data, we just acknowledge the request.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { payload, topic, shop } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);
  console.log("Customer redact request received:", JSON.stringify(payload, null, 2));

  // This app stores safety alerts linked to products, not to customers.
  // No customer-specific data needs to be deleted.

  return new Response(null, { status: 200 });
};

