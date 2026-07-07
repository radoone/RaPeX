import type { LoaderFunctionArgs } from "react-router";
import { getProductSafetyStatus } from "../services/product-safety-admin.server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, cors } = await authenticate.admin(request);
  const url = new URL(request.url);
  const productId = url.searchParams.get("productId");

  if (!productId) {
    return cors(Response.json({ error: "Missing productId query parameter" }, { status: 400 }));
  }

  const status = await getProductSafetyStatus(session.shop, productId);
  return cors(Response.json(status));
};
