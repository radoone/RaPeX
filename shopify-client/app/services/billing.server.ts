import { hasOwnerTestAccess } from "./owner-test-access.server";
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
import { partnerEntitlement } from "./partner-entitlement";
import db from "../merchant-db.server";

type AdminApi = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

type BillingContext = {
  check: (options?: {
    isTest: boolean;
  }) => Promise<{ hasActivePayment: boolean }>;
};

type Subscription = import("./partner-entitlement").PartnerSubscription;

type PartnerSubscriptionResult = {
  subscription: Subscription | null;
  shopId: string;
};

export type BillingStatus = {
  hasActivePayment: boolean;
  ownerTestAccess?: boolean;
  freeScanUsed: boolean;
  freeScanCompletedAt: Date | null;
  canPerformScan: boolean;
  pricingPlansUrl: string | null;
  billingVerified: boolean;
  developmentBypass: boolean;
  planHandle: string | null;
  cancelAtEndOfCycle: boolean;
  subscriptionActivatedAt?: Date | null;
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
  return Boolean(
    SHOPIFY_PARTNER_ORG_ID && SHOPIFY_PARTNER_API_TOKEN && SHOPIFY_APP_GID,
  );
}

async function fetchActivePartnerSubscription(
  admin: AdminApi,
): Promise<PartnerSubscriptionResult> {
  const shopResponse = await admin.graphql(
    "query BillingShopId { shop { id } }",
  );
  const shopPayload = (await shopResponse.json()) as {
    data?: { shop?: { id?: string } };
    errors?: unknown[];
  };
  const shopId = shopPayload.data?.shop?.id;
  if (!shopResponse.ok || !shopId || shopPayload.errors?.length) {
    throw new Error(
      "Shopify did not return the shop ID needed to verify its subscription.",
    );
  }

  const response = await fetch(
    `https://partners.shopify.com/${encodeURIComponent(SHOPIFY_PARTNER_ORG_ID)}/api/${encodeURIComponent(SHOPIFY_PARTNER_API_VERSION)}/graphql.json`,
    {
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
          items { handle }
        }
      }`,
        variables: { appId: SHOPIFY_APP_GID, shopId },
      }),
      signal: AbortSignal.timeout(10_000),
    },
  );
  const payload = (await response.json()) as {
    data?: { activeSubscription?: Subscription | null };
    errors?: unknown[];
  };
  if (!response.ok || payload.errors?.length || !payload.data || !("activeSubscription" in payload.data)) {
    throw new Error("Shopify Partner API could not verify the subscription.");
  }
  return { subscription: payload.data.activeSubscription || null, shopId };
}

async function readEntitlement(
  billing: unknown,
  admin?: AdminApi,
): Promise<{
  active: boolean;
  verified: boolean;
  planHandle: string | null;
  cancelAtEndOfCycle: boolean;
  validUntil: Date | null;
  shopifyShopId?: string;
}> {
  if (SHOPIFY_BILLING_MODE === "legacy") {
    const result = await (billing as BillingContext).check({
      isTest: SHOPIFY_BILLING_TEST,
    });
    return {
      active: Boolean(result?.hasActivePayment),
      verified: true,
      planHandle: null,
      cancelAtEndOfCycle: false,
      validUntil: null,
    };
  }
  if (!hasPartnerPricingConfig() || !admin) {
    return {
      active: false,
      verified: false,
      planHandle: null,
      cancelAtEndOfCycle: false,
      validUntil: null,
    };
  }
  const { subscription, shopId } = await fetchActivePartnerSubscription(admin);
  return partnerEntitlement(subscription, shopId);
}

async function saveEntitlement(
  shop: string,
  entitlement: Awaited<ReturnType<typeof readEntitlement>>,
): Promise<{ saved: boolean; subscriptionActivatedAt: Date | null }> {
  // A failed lookup is not a Shopify cancellation. Keep the verified finite
  // snapshot for background workers while the current request fails closed.
  if (!entitlement.verified) return { saved: false, subscriptionActivatedAt: null };

  try {
    const existing = await db.safetySetting.findUnique({ where: { shop } });
    const subscriptionActivatedAt = entitlement.active
      ? existing?.subscriptionStatus === "active" &&
          existing.planHandle === entitlement.planHandle &&
          existing.subscriptionActivatedAt
        ? existing.subscriptionActivatedAt
        : new Date()
      : null;
    await db.safetySetting.upsert({
      where: { shop },
      update: {
        subscriptionStatus: entitlement.verified
          ? entitlement.active
            ? "active"
            : "inactive"
          : "unknown",
        planHandle: entitlement.planHandle,
        monitoringEntitled: entitlement.verified && entitlement.active,
        billingVerifiedAt: entitlement.verified ? new Date() : null,
        subscriptionActivatedAt,
        subscriptionValidUntil: entitlement.validUntil
          ? new Date(
              Math.min(
                entitlement.validUntil.getTime(),
                Date.now() + 24 * 60 * 60_000,
              ),
            )
          : null,
        subscriptionPeriodEnd: entitlement.validUntil,
        ...(entitlement.shopifyShopId
          ? {
              shopifyShopId: entitlement.shopifyShopId,
              billingRefreshAfter: new Date(Date.now() + 60 * 60_000),
            }
          : {}),
      },
      create: {
        shop,
        similarityThreshold: existing?.similarityThreshold || 70,
        subscriptionStatus: entitlement.verified
          ? entitlement.active
            ? "active"
            : "inactive"
          : "unknown",
        planHandle: entitlement.planHandle,
        monitoringEntitled: entitlement.verified && entitlement.active,
        billingVerifiedAt: entitlement.verified ? new Date() : null,
        subscriptionActivatedAt,
        subscriptionValidUntil: entitlement.validUntil
          ? new Date(
              Math.min(
                entitlement.validUntil.getTime(),
                Date.now() + 24 * 60 * 60_000,
              ),
            )
          : null,
        subscriptionPeriodEnd: entitlement.validUntil,
        ...(entitlement.shopifyShopId
          ? {
              shopifyShopId: entitlement.shopifyShopId,
              billingRefreshAfter: new Date(Date.now() + 60 * 60_000),
            }
          : {}),
      },
    });
    return { saved: true, subscriptionActivatedAt };
  } catch {
    console.warn("Could not persist verified Shopify subscription state");
    return { saved: false, subscriptionActivatedAt: null };
  }
}

export async function hasCurrentMonitoringEntitlement(
  shop: string,
): Promise<boolean> {
  if (await hasOwnerTestAccess(shop)) return true;
  const settings = await db.safetySetting.findUnique({ where: { shop } });
  if (
    settings?.subscriptionStatus !== "active" ||
    settings.monitoringEntitled !== true
  )
    return false;
  return (
    !settings.subscriptionValidUntil ||
    settings.subscriptionValidUntil.getTime() > Date.now()
  );
}

const BILLING_CACHE_TTL_MS = 30_000;
const billingStatusCache = new Map<string, { status: BillingStatus; expiresAt: number }>();
const pendingBillingStatus = new Map<string, Promise<BillingStatus>>();

export function invalidateBillingStatusCache(shop: string) {
  billingStatusCache.delete(shop);
}

export async function getBillingStatus(
  billing: unknown,
  shop: string,
  admin?: AdminApi,
): Promise<BillingStatus> {
  if (process.env.NODE_ENV === "production") {
    const cached = billingStatusCache.get(shop);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.status;
    }
  }
  const existing = pendingBillingStatus.get(shop);
  if (existing) return existing;
  const pending = loadBillingStatus(billing, shop, admin)
    .then((status) => {
      if (
        process.env.NODE_ENV === "production" &&
        (status.billingVerified || status.ownerTestAccess || status.developmentBypass)
      ) {
        billingStatusCache.set(shop, {
          status,
          expiresAt: Date.now() + BILLING_CACHE_TTL_MS,
        });
      }
      return status;
    })
    .finally(() => {
      if (pendingBillingStatus.get(shop) === pending) {
        pendingBillingStatus.delete(shop);
      }
    });
  pendingBillingStatus.set(shop, pending);
  return pending;
}

async function loadBillingStatus(
  billing: unknown,
  shop: string,
  admin?: AdminApi,
): Promise<BillingStatus> {
  const pricingPlansUrl = getPricingPlansUrl(shop);
  const settings = await db.safetySetting.findUnique({ where: { shop } });
  const freeScanUsed = Boolean(settings?.freeScanUsed);
  const freeScanCompletedAt = settings?.freeScanCompletedAt || null;

  if (await hasOwnerTestAccess(shop)) {
    return { hasActivePayment: false, ownerTestAccess: true, freeScanUsed, freeScanCompletedAt, canPerformScan: true, pricingPlansUrl, billingVerified: false, developmentBypass: false, planHandle: null, cancelAtEndOfCycle: false, subscriptionActivatedAt: null, validUntil: null };
  }

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
      subscriptionActivatedAt: null,
      validUntil: null,
    };
  }

  try {
    const entitlement = await readEntitlement(billing, admin);
    const persisted = await saveEntitlement(shop, entitlement);
    if (!persisted.saved)
      throw new Error("Subscription verification could not be persisted");
    return {
      hasActivePayment: entitlement.active,
      freeScanUsed,
      freeScanCompletedAt,
      canPerformScan:
        entitlement.verified && (entitlement.active || !freeScanUsed),
      pricingPlansUrl,
      billingVerified: entitlement.verified,
      developmentBypass: false,
      planHandle: entitlement.planHandle,
      cancelAtEndOfCycle: entitlement.cancelAtEndOfCycle,
      subscriptionActivatedAt: persisted.subscriptionActivatedAt,
      validUntil: entitlement.validUntil,
    };
  } catch (error) {
    console.error("Error checking billing status:", error);
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
      subscriptionActivatedAt: null,
      validUntil: null,
    };
  }
}

export async function requireActiveBilling(
  billing: unknown,
  shop: string,
  options?: { allowFreeInitialScan?: boolean; admin?: AdminApi },
): Promise<Response | null> {
  if (SHOPIFY_BILLING_BYPASS || await hasOwnerTestAccess(shop)) return null;

  let entitlement: Awaited<ReturnType<typeof readEntitlement>>;
  try {
    entitlement = await readEntitlement(billing, options?.admin);
  } catch (error) {
    console.error("Error checking billing in requireActiveBilling:", error);
    entitlement = {
      active: false,
      verified: false,
      planHandle: null,
      cancelAtEndOfCycle: false,
      validUntil: null,
    };
  }
  if (!(await saveEntitlement(shop, entitlement)).saved) {
    entitlement = {
      active: false,
      verified: false,
      planHandle: null,
      cancelAtEndOfCycle: false,
      validUntil: null,
    };
  }

  if (entitlement.active) return null;
  if (!entitlement.verified) {
    return redirect("/billing/redirect?billingError=1");
  }
  if (entitlement.verified && options?.allowFreeInitialScan) {
    const settings = await db.safetySetting.findUnique({ where: { shop } });
    if (!settings?.freeScanUsed) return null;
  }

  const pricingUrl = getPricingPlansUrl(shop);
  if (!pricingUrl)
    throw new Response("Shopify pricing is not configured for this app.", {
      status: 503,
    });
  return redirect(`/billing/redirect?to=${encodeURIComponent(pricingUrl)}`);
}
