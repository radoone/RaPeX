import { redirect } from "react-router";
import {
  SHOPIFY_APP_HANDLE,
  SHOPIFY_BILLING_BYPASS,
  SHOPIFY_BILLING_TEST,
} from "../shopify.server";
import db from "../merchant-db.server";

type BillingContext = {
  check: (options?: {
    isTest: boolean;
  }) => Promise<{ hasActivePayment: boolean }>;
};

export type BillingStatus = {
  hasActivePayment: boolean;
  freeScanUsed: boolean;
  freeScanCompletedAt: Date | null;
  canPerformScan: boolean;
  pricingPlansUrl: string;
};

export function shopHandleFromShopDomain(shop: string): string {
  return shop.replace(".myshopify.com", "");
}

export function getPricingPlansUrl(shop: string): string {
  if (!SHOPIFY_APP_HANDLE) {
    const storeHandle = shopHandleFromShopDomain(shop);
    return `https://admin.shopify.com/store/${storeHandle}`;
  }

  const storeHandle = shopHandleFromShopDomain(shop);
  return `https://admin.shopify.com/store/${storeHandle}/charges/${SHOPIFY_APP_HANDLE}/pricing_plans`;
}

export async function getBillingStatus(
  billing: unknown,
  shop: string,
): Promise<BillingStatus> {
  const url = getPricingPlansUrl(shop);
  const settings = await db.safetySetting.findUnique({ where: { shop } });
  const freeScanUsed = Boolean(settings?.freeScanUsed);
  const freeScanCompletedAt = settings?.freeScanCompletedAt || null;

  if (SHOPIFY_BILLING_BYPASS) {
    return {
      hasActivePayment: true,
      freeScanUsed,
      freeScanCompletedAt,
      canPerformScan: true,
      pricingPlansUrl: url,
    };
  }

  try {
    const billingContext = billing as BillingContext;
    const billingCheck = await billingContext.check({
      isTest: SHOPIFY_BILLING_TEST,
    });
    const hasActivePayment = Boolean(billingCheck?.hasActivePayment);

    return {
      hasActivePayment,
      freeScanUsed,
      freeScanCompletedAt,
      canPerformScan: hasActivePayment || !freeScanUsed,
      pricingPlansUrl: url,
    };
  } catch (error) {
    console.error("Error checking billing status:", error);
    return {
      hasActivePayment: false,
      freeScanUsed,
      freeScanCompletedAt,
      canPerformScan: !freeScanUsed,
      pricingPlansUrl: url,
    };
  }
}

export async function requireActiveBilling(
  billing: unknown,
  shop: string,
  options?: { allowFreeInitialScan?: boolean },
): Promise<Response | null> {
  if (SHOPIFY_BILLING_BYPASS) {
    return null;
  }

  try {
    const billingContext = billing as BillingContext;
    const billingCheck = await billingContext.check({
      isTest: SHOPIFY_BILLING_TEST,
    });

    if (billingCheck?.hasActivePayment) {
      return null;
    }
  } catch (error) {
    console.error("Error checking billing in requireActiveBilling:", error);
  }

  // If allowFreeInitialScan is requested, check if the merchant has not yet used their free scan
  if (options?.allowFreeInitialScan) {
    const settings = await db.safetySetting.findUnique({ where: { shop } });
    if (!settings?.freeScanUsed) {
      return null;
    }
  }

  const target = encodeURIComponent(getPricingPlansUrl(shop));
  return redirect(`/billing/redirect?to=${target}`);
}

