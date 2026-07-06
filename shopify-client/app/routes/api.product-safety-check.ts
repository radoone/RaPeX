import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { runProductSafetyCheckForAdminProduct } from "../services/product-safety-admin.server";
import { authenticate } from "../shopify.server";
import { requireActiveBilling } from "../services/billing.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, billing, session, cors } = await authenticate.admin(request);
  const billingRedirect = await requireActiveBilling(billing, session.shop);
  if (billingRedirect) return billingRedirect as never;

  try {
    const payload = await request.json();
    const productId = typeof payload?.productId === "string" ? payload.productId : "";

    if (!productId) {
      return cors(json({ error: "Missing productId in request body" }, { status: 400 }));
    }

    const result = await runProductSafetyCheckForAdminProduct({
      admin,
      shop: session.shop,
      productId,
    });

    return cors(json(result));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return cors(json({ error: message }, { status: 500 }));
  }
};
