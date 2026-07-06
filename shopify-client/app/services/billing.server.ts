import { redirect } from "@remix-run/node";
import {
  SHOPIFY_APP_HANDLE,
  SHOPIFY_BILLING_BYPASS,
  SHOPIFY_BILLING_TEST,
} from "../shopify.server";

type BillingContext = {
  check: (options?: {
    isTest: boolean;
  }) => Promise<{ hasActivePayment: boolean }>;
};

function shopHandleFromShopDomain(shop: string): string {
  return shop.replace(".myshopify.com", "");
}

function pricingPlansUrl(shop: string): string {
  if (!SHOPIFY_APP_HANDLE) {
    throw new Error("SHOPIFY_APP_HANDLE is required for Shopify App Pricing.");
  }

  const storeHandle = shopHandleFromShopDomain(shop);
  return `https://admin.shopify.com/store/${storeHandle}/charges/${SHOPIFY_APP_HANDLE}/pricing_plans`;
}

export async function requireActiveBilling(
  billing: unknown,
  shop: string,
): Promise<Response | null> {
  if (SHOPIFY_BILLING_BYPASS) {
    return null;
  }

  const billingContext = billing as BillingContext;
  const billingCheck = await billingContext.check({
    isTest: SHOPIFY_BILLING_TEST,
  });

  if (!billingCheck.hasActivePayment) {
    const target = encodeURIComponent(pricingPlansUrl(shop));
    return redirect(`/billing/redirect?to=${target}`);
  }

  return null;
}
