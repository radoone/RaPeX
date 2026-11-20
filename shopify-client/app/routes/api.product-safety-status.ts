import type { LoaderFunctionArgs } from "react-router";
import { getProductSafetyStatus, productSafetyReviewUrl } from "../services/product-safety-admin.server";
import { authenticate, SHOPIFY_APP_HANDLE } from "../shopify.server";

export const loader = async ({ request, url }: LoaderFunctionArgs) => {
  const { admin, session, cors } = await authenticate.admin(request);
  const productId = url.searchParams.get("productId");

  if (!productId) {
    return cors(Response.json({ error: "Missing productId query parameter" }, { status: 400 }));
  }

  const response = await admin.graphql(
    `#graphql
      query ProductSafetyStatusVersion($id: ID!) {
        product(id: $id) { updatedAt }
      }`,
    { variables: { id: productId.startsWith("gid://") ? productId : `gid://shopify/Product/${productId}` } },
  );
  const payload = await response.json() as {
    errors?: unknown[];
    data?: { product?: { updatedAt?: string } | null };
  };
  const updatedAt = payload.data?.product?.updatedAt;
  if (payload.errors?.length || typeof updatedAt !== "string") {
    return cors(Response.json({ error: "Product version unavailable" }, { status: 502 }));
  }
  const status = await getProductSafetyStatus(session.shop, productId, updatedAt);
  return cors(Response.json({ ...status, reviewUrl: productSafetyReviewUrl(session.shop, status.alertId, SHOPIFY_APP_HANDLE) }));
};
