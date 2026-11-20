import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { productSafetyReviewUrl, runProductSafetyCheckForAdminProduct } from "../services/product-safety-admin.server";
import { authenticate, SHOPIFY_APP_HANDLE } from "../shopify.server";
import { getPricingPlansUrl, requireActiveBilling } from "../services/billing.server";
import { ProductCheckExcludedError } from "../services/safety-gate-checker.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  if (request.method === "OPTIONS") {
    // The Shopify SDK responds with the CORS preflight before loading a session.
    await authenticate.admin(request);
  }
  return new Response(null, { status: 405, headers: { Allow: "OPTIONS, POST" } });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, billing, session, cors } = await authenticate.admin(request);
  if (request.method !== "POST") {
    return cors(new Response(null, { status: 405, headers: { Allow: "OPTIONS, POST" } }));
  }
  const billingRedirect = await requireActiveBilling(billing, session.shop, { admin });
  if (billingRedirect) {
    const needsPlan = billingRedirect.headers.get("Location")?.startsWith("/billing/redirect?to=");
    return cors(Response.json({
      pricingPlansUrl: needsPlan ? getPricingPlansUrl(session.shop) : null,
    }, { status: 403 }));
  }

  try {
    const payload = await request.json();
    const productId = typeof payload?.productId === "string" ? payload.productId : "";

    if (!productId) {
      return cors(Response.json({ error: "Missing productId in request body" }, { status: 400 }));
    }

    const result = await runProductSafetyCheckForAdminProduct({
      admin,
      shop: session.shop,
      productId,
    });

    return cors(Response.json({
      ...result,
      reviewUrl: productSafetyReviewUrl(session.shop, result.status.alertId, SHOPIFY_APP_HANDLE),
    }));
  } catch (error) {
    if (error instanceof ProductCheckExcludedError) {
      return cors(Response.json({ excluded: true }, { status: 422 }));
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    return cors(Response.json({ error: message }, { status: 500 }));
  }
};
