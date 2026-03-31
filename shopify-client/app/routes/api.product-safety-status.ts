import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { getProductSafetyStatus } from "../services/product-safety-admin.server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, cors } = await authenticate.admin(request);
  const url = new URL(request.url);
  const productId = url.searchParams.get("productId");

  if (!productId) {
    return cors(json({ error: "Missing productId query parameter" }, { status: 400 }));
  }

  const status = await getProductSafetyStatus(session.shop, productId);
  return cors(json(status));
};
