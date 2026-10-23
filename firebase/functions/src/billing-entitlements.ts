import { FieldValue, Timestamp } from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";
import { db } from "./firebase-admin.js";

type Subscription = { shop?: { id?: string }; currentBillingCycle?: { endTime?: string }; trialEndsAt?: string; cancelAtEndOfCycle?: boolean; items?: Array<{ handle?: string; price?: { active?: boolean } }> };
export function parsePartnerEntitlement(subscription: Subscription | null, shopId: string, now = Date.now()) {
  if (subscription && subscription.shop?.id !== shopId) throw new Error("Subscription tenant mismatch");
  const items = subscription?.items?.filter(item => item.price?.active === true) || [];
  const end = Date.parse(subscription?.currentBillingCycle?.endTime || subscription?.trialEndsAt || "");
  const active = Boolean(subscription && items.length && Number.isFinite(end) && end > now);
  return {
    subscriptionStatus: active ? "active" : "inactive", monitoringEntitled: active,
    planHandle: active ? items.map(item => item.handle).find(Boolean) || null : null,
    subscriptionPeriodEnd: active ? Timestamp.fromMillis(end) : null,
    subscriptionValidUntil: active ? Timestamp.fromMillis(Math.min(end, now + 24 * 60 * 60_000)) : null,
    cancelAtEndOfCycle: Boolean(subscription?.cancelAtEndOfCycle),
  };
}

/** Renew the finite access cache while Shopify Admin is closed. Bounded oldest-due work. */
export async function refreshShopifyEntitlements(): Promise<{ verified: number; failed: number }> {
  const org = process.env.SHOPIFY_PARTNER_ORG_ID;
  const token = process.env.SHOPIFY_PARTNER_API_TOKEN;
  const appId = process.env.SHOPIFY_APP_GID;
  if (!org || !token || !appId) throw new Error("Partner billing verification is not configured");
  const startedAt = Date.now();
  const cutoff = Timestamp.fromMillis(startedAt);
  let verified = 0, failed = 0;
  for (;;) {
  const due = await db.collection("merchants").where("billingRefreshAfter", "<=", cutoff).orderBy("billingRefreshAfter").limit(100).get();
  if (!due.size) break;
  for (let index = 0; index < due.docs.length; index += 5) {
    await Promise.all(due.docs.slice(index, index + 5).map(async merchant => {
      const shopId = merchant.get("shopifyShopId");
      try {
        if (typeof shopId !== "string" || !/^gid:\/\/shopify\/Shop\/\d+$/.test(shopId)) throw new Error("Missing verified shop identity");
        const response = await fetch(`https://partners.shopify.com/${encodeURIComponent(org)}/api/${encodeURIComponent(process.env.SHOPIFY_PARTNER_API_VERSION || "2026-07")}/graphql.json`, {
          method: "POST", headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
          body: JSON.stringify({ query: "query($appId: ID!, $shopId: ID!) { activeSubscription(appId:$appId, shopId:$shopId) { shop { id } cancelAtEndOfCycle trialEndsAt currentBillingCycle { endTime } items { handle price { active } } } }", variables: { appId, shopId } }),
          signal: globalThis.AbortSignal.timeout(10_000),
        });
        const payload = await response.json() as { data?: { activeSubscription?: Subscription | null }; errors?: unknown[] };
        if (!response.ok || payload.errors?.length || !payload.data || !("activeSubscription" in payload.data)) throw new Error("Subscription verification failed");
        const entitlement = parsePartnerEntitlement(payload.data.activeSubscription || null, shopId);
        await db.runTransaction(async transaction => {
          const current = await transaction.get(merchant.ref);
          if (!current.exists || current.get("shopifyShopId") !== shopId) return;
          transaction.update(merchant.ref, { ...entitlement, billingVerifiedAt: FieldValue.serverTimestamp(), billingRefreshAfter: Timestamp.fromMillis(Date.now() + 60 * 60_000), billingRefreshErrorCode: FieldValue.delete() });
        });
        verified++;
      } catch {
        failed++;
        // Keep an already verified, finite cache during a temporary provider outage.
        // Move failures behind other due shops so they cannot starve verification.
        await db.runTransaction(async transaction => {
          const current = await transaction.get(merchant.ref);
          if (current.exists) transaction.update(merchant.ref, { billingRefreshAfter: Timestamp.fromMillis(Date.now() + 5 * 60_000), billingRefreshErrorCode: "verification_failed" });
        });
        logger.error("Scheduled subscription verification failed", { merchantId: merchant.id });
      }
    }));
  }
  if (due.size < 100) break;
  if (Date.now() - startedAt > 7 * 60_000) {
    logger.error("Subscription verification capacity exceeded; oldest-due work remains for the next run");
    break;
  }
  }
  return { verified, failed };
}
