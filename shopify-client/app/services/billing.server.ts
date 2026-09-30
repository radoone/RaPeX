import { redirect } from "react-router";
import {
  SHOPIFY_APP_GID,
  SHOPIFY_APP_HANDLE,
  SHOPIFY_BILLING_BYPASS,
  SHOPIFY_BILLING_MODE,
  SHOPIFY_BILLING_TEST,
  SHOPIFY_PARTNER_API_TOKEN,
  SHOPIFY_PARTNER_API_VERSION,
  SHOPIFY_PARTNER_ORG_ID,
} from "../shopify.server";
import db from "../merchant-db.server";

type AdminApi = {
  graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response>;
};

type BillingContext = {
  check: (options?: { isTest: boolean }) => Promise<{ hasActivePayment: boolean }>;
};

type Subscription = {
  shop?: { id?: string };
  currentBillingCycle?: { endTime?: string | null } | null;
  trialEndsAt?: string | null;
  cancelAtEndOfCycle?: boolean;
  items?: Array<{ handle?: string; price?: { active?: boolean } }>;
};

type PartnerSubscriptionResult = { subscription: Subscription | null; shopId: string };

export type BillingStatus = {
  hasActivePayment: boolean;
  freeScanUsed: boolean;
  freeScanCompletedAt: Date | null;
  canPerformScan: boolean;
  pricingPlansUrl: string | null;
  billingVerified: boolean;
  developmentBypass: boolean;
  planHandle: string | null;
  cancelAtEndOfCycle: boolean;
  validUntil: Date | null;
};

export function shopHandleFromShopDomain(shop: string): string {
  return shop.replace(/\.myshopify\.com$/i, "");
}

export function getPricingPlansUrl(shop: string): string | null {
  if (!SHOPIFY_APP_HANDLE) return null;
  return `https://admin.shopify.com/store/${encodeURIComponent(shopHandleFromShopDomain(shop))}/charges/${encodeURIComponent(SHOPIFY_APP_HANDLE)}/pricing_plans`;
}

function hasPartnerPricingConfig(): boolean {
  return Boolean(SHOPIFY_PARTNER_ORG_ID && SHOPIFY_PARTNER_API_TOKEN && SHOPIFY_APP_GID);
}

async function fetchActivePartnerSubscription(admin: AdminApi): Promise<PartnerSubscriptionResult> {
  const shopResponse = await admin.graphql("query BillingShopId { shop { id } }");
  const shopPayload = await shopResponse.json() as { data?: { shop?: { id?: string } }; errors?: unknown[] };
  const shopId = shopPayload.data?.shop?.id;
  if (!shopResponse.ok || !shopId || shopPayload.errors?.length) {
    throw new Error("Shopify did not return the shop ID needed to verify its subscription.");
  }

  const response = await fetch(`https://partners.shopify.com/${encodeURIComponent(SHOPIFY_PARTNER_ORG_ID)}/api/${encodeURIComponent(SHOPIFY_PARTNER_API_VERSION)}/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": SHOPIFY_PARTNER_API_TOKEN,
    },
    body: JSON.stringify({
      query: `query ActiveSubscription($appId: ID!, $shopId: ID!) {
        activeSubscription(appId: $appId, shopId: $shopId) {
          shop { id }
          cancelAtEndOfCycle
          trialEndsAt
          currentBillingCycle { endTime }
          items { handle price { active } }
        }
      }`,
      variables: { appId: SHOPIFY_APP_GID, shopId },
    }),
  });
  const payload = await response.json() as {
    data?: { activeSubscription?: Subscription | null };
    errors?: unknown[];
  };
  if (!response.ok || payload.errors?.length || !payload.data) {
    throw new Error("Shopify Partner API could not verify the subscription.");
  }
  return { subscription: payload.data.activeSubscription || null, shopId };
}

async function readEntitlement(billing: unknown, admin?: AdminApi): Promise<{
  active: boolean;
  verified: boolean;
  planHandle: string | null;
  cancelAtEndOfCycle: boolean;
  validUntil: Date | null;
}> {
  if (SHOPIFY_BILLING_MODE === "legacy") {
    const result = await (billing as BillingContext).check({ isTest: SHOPIFY_BILLING_TEST });
    return { active: Boolean(result?.hasActivePayment), verified: true, planHandle: null, cancelAtEndOfCycle: false, validUntil: null };
  }
  if (!hasPartnerPricingConfig() || !admin) {
    return { active: false, verified: false, planHandle: null, cancelAtEndOfCycle: false, validUntil: null };
  }
  const { subscription } = await fetchActivePartnerSubscription(admin);
  const activeItems = subscription?.items?.filter((item) => item.price?.active !== false) || [];
  const endTime = subscription?.currentBillingCycle?.endTime || subscription?.trialEndsAt || null;
  return {
    active: Boolean(subscription && activeItems.length),
    verified: true,
    planHandle: activeItems.map((item) => item.handle).find(Boolean) || null,
    cancelAtEndOfCycle: Boolean(subscription?.cancelAtEndOfCycle),
    validUntil: endTime ? new Date(endTime) : null,
  };
}

async function saveEntitlement(shop: string, entitlement: Awaited<ReturnType<typeof readEntitlement>>) {
  try {
    const existing = await db.safetySetting.findUnique({ where: { shop } });
    await db.safetySetting.upsert({
      where: { shop },
      update: {
        subscriptionStatus: entitlement.verified ? (entitlement.active ? "active" : "inactive") : "unknown",
        planHandle: entitlement.planHandle,
        monitoringEntitled: entitlement.verified && entitlement.active,
        billingVerifiedAt: entitlement.verified ? new Date() : null,
        subscriptionValidUntil: entitlement.validUntil,
      },
      create: {
        shop,
        similarityThreshold: existing?.similarityThreshold || 70,
        subscriptionStatus: entitlement.verified ? (entitlement.active ? "active" : "inactive") : "unknown",
        planHandle: entitlement.planHandle,
        monitoringEntitled: entitlement.verified && entitlement.active,
        billingVerifiedAt: entitlement.verified ? new Date() : null,
        subscriptionValidUntil: entitlement.validUntil,
      },
    });
  } catch (error) {
    console.warn("Could not persist verified Shopify subscription state", error);
  }
}

export async function hasCurrentMonitoringEntitlement(shop: string): Promise<boolean> {
  const settings = await db.safetySetting.findUnique({ where: { shop } });
  if (settings?.subscriptionStatus !== "active" || settings.monitoringEntitled !== true) return false;
  return !settings.subscriptionValidUntil || settings.subscriptionValidUntil.getTime() > Date.now();
}

export async function getBillingStatus(
  billing: unknown,
  shop: string,
  admin?: AdminApi,
): Promise<BillingStatus> {
  const pricingPlansUrl = getPricingPlansUrl(shop);
  const settings = await db.safetySetting.findUnique({ where: { shop } });
  const freeScanUsed = Boolean(settings?.freeScanUsed);
  const freeScanCompletedAt = settings?.freeScanCompletedAt || null;

  if (SHOPIFY_BILLING_BYPASS) {
    return {
      hasActivePayment: true,
      freeScanUsed,
      freeScanCompletedAt,
      canPerformScan: true,
      pricingPlansUrl,
      billingVerified: false,
      developmentBypass: true,
      planHandle: null,
      cancelAtEndOfCycle: false,
      validUntil: null,
    };
  }

  try {
    const entitlement = await readEntitlement(billing, admin);
    await saveEntitlement(shop, entitlement);
    return {
      hasActivePayment: entitlement.active,
      freeScanUsed,
      freeScanCompletedAt,
      canPerformScan: entitlement.verified && (entitlement.active || !freeScanUsed),
      pricingPlansUrl,
      billingVerified: entitlement.verified,
      developmentBypass: false,
      planHandle: entitlement.planHandle,
      cancelAtEndOfCycle: entitlement.cancelAtEndOfCycle,
      validUntil: entitlement.validUntil,
    };
  } catch (error) {
    console.error("Error checking billing status:", error);
    await saveEntitlement(shop, { active: false, verified: false, planHandle: null, cancelAtEndOfCycle: false, validUntil: null });
    return {
      hasActivePayment: false,
      freeScanUsed,
      freeScanCompletedAt,
      canPerformScan: false,
      pricingPlansUrl,
      billingVerified: false,
      developmentBypass: false,
      planHandle: null,
      cancelAtEndOfCycle: false,
      validUntil: null,
    };
  }
}

export async function requireActiveBilling(
  billing: unknown,
  shop: string,
  options?: { allowFreeInitialScan?: boolean; admin?: AdminApi },
): Promise<Response | null> {
  if (SHOPIFY_BILLING_BYPASS) return null;

  let entitlement: Awaited<ReturnType<typeof readEntitlement>>;
  try {
    entitlement = await readEntitlement(billing, options?.admin);
  } catch (error) {
    console.error("Error checking billing in requireActiveBilling:", error);
    entitlement = { active: false, verified: false, planHandle: null, cancelAtEndOfCycle: false, validUntil: null };
  }
  await saveEntitlement(shop, entitlement);

  if (entitlement.active) return null;
  if (!entitlement.verified) {
    return redirect("/billing/redirect?billingError=1");
  }
  if (entitlement.verified && options?.allowFreeInitialScan) {
    const settings = await db.safetySetting.findUnique({ where: { shop } });
    if (!settings?.freeScanUsed) return null;
  }

  const pricingUrl = getPricingPlansUrl(shop);
  if (!pricingUrl) throw new Response("Shopify pricing is not configured for this app.", { status: 503 });
  return redirect(`/billing/redirect?to=${encodeURIComponent(pricingUrl)}`);
}
