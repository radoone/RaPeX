import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";

/**
 * GDPR webhook: customers/data_request
 * Shopify sends this when a customer requests their data.
 * Since this app doesn't store personal customer data, we just acknowledge the request.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { payload, topic, shop } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);
  console.log("Customer data request received:", JSON.stringify(payload, null, 2));

  // This app stores safety alerts linked to products, not to customers.
  // No customer-specific data needs to be returned.

  return new Response(null, { status: 200 });
};

