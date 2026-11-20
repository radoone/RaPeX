export type PartnerSubscription = {
  shop?: { id?: string };
  currentBillingCycle?: { endTime?: string | null } | null;
  trialEndsAt?: string | null;
  cancelAtEndOfCycle?: boolean;
  items?: Array<{ handle?: string }>;
};
export function partnerEntitlement(
  subscription: PartnerSubscription | null,
  shopId: string,
  now = Date.now(),
) {
  if (subscription && subscription.shop?.id !== shopId)
    throw new Error("Subscription shop does not match authenticated shop");
  // Shopify verifies the contract via activeSubscription. A superseded price
  // or effective zero price can be inactive while the contract remains active.
  const planHandle = subscription?.items?.find((item) => item.handle?.trim())?.handle || null;
  const value =
    subscription?.currentBillingCycle?.endTime || subscription?.trialEndsAt;
  const validUntil = value ? new Date(value) : null;
  const active = Boolean(
    subscription &&
    planHandle &&
    validUntil &&
    Number.isFinite(validUntil.getTime()) &&
    validUntil.getTime() > now,
  );
  return {
    shopifyShopId: shopId,
    active,
    verified: true,
    planHandle: active ? planHandle : null,
    cancelAtEndOfCycle: Boolean(subscription?.cancelAtEndOfCycle),
    validUntil: active ? validUntil : null,
  };
}

/** Shopify exposes the plan handle in the subscription response. */
export function displayShopifyPlan(handle: string | null | undefined): string | null {
  const name = handle?.trim().replace(/[-_]+/g, " ").trim();
  if (!name) return null;
  if (name.toLowerCase() === "shopify test") return "Review test";
  if (name.toLowerCase() === "zerorecall pro") return "ZeroRecall Pro";
  return name[0].toUpperCase() + name.slice(1);
}
