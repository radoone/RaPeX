import { apiVersion, SHOPIFY_APP_GID, SHOPIFY_BILLING_MODE } from "../shopify.server";

/** Only the authenticated store owner can cancel this installation's subscription. */
export async function cancelSubscription(request: Request, shop: string, userId: string) {
  const token = request.headers.get("Authorization")?.match(/^Bearer (\S+)$/i)?.[1];
  if (!token || !/^[-a-z0-9]+\.myshopify\.com$/.test(shop) || SHOPIFY_BILLING_MODE !== "app-pricing") {
    return "failed";
  }
  const base = `https://${shop}/admin`;
  const exchange = await fetch(`${base}/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(10_000),
    body: JSON.stringify({
      client_id: process.env.SHOPIFY_API_KEY,
      client_secret: process.env.SHOPIFY_API_SECRET,
      grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
      subject_token: token,
      subject_token_type: "urn:ietf:params:oauth:token-type:id_token",
      requested_token_type: "urn:shopify:params:oauth:token-type:online-access-token",
    }),
  });
  if (!exchange.ok) return "failed";
  const online = await exchange.json();
  if (online.associated_user?.account_owner !== true || String(online.associated_user?.id) !== userId) {
    return "ownerRequired";
  }
  if (typeof online.access_token !== "string" || !online.access_token) return "failed";

  async function graphql(query: string, variables?: Record<string, string>) {
    const response = await fetch(`${base}/api/${apiVersion}/graphql.json`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": online.access_token },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(10_000),
    });
    const result = await response.json();
    if (!response.ok || result.errors?.length) throw new Error("Shopify billing request failed");
    return result.data;
  }

  const data = await graphql(`query CancellableSubscription {
    currentAppInstallation { app { id } activeSubscriptions { id status } }
  }`);
  const installation = data?.currentAppInstallation;
  const subscriptions = installation?.activeSubscriptions;
  if (!SHOPIFY_APP_GID || installation?.app?.id !== SHOPIFY_APP_GID || !Array.isArray(subscriptions) ||
    subscriptions.length !== 1 || subscriptions[0]?.status !== "ACTIVE" ||
    !/^gid:\/\/shopify\/AppSubscription\/\d+$/.test(subscriptions[0]?.id)) return "failed";

  const id = subscriptions[0].id;
  const result = await graphql(`mutation StopRenewal($id: ID!) {
    appSubscriptionCancel(id: $id, prorate: false) {
      appSubscription { id status }
      userErrors { message }
    }
  }`, { id });
  const cancellation = result?.appSubscriptionCancel;
  return cancellation?.appSubscription?.id === id &&
    cancellation.appSubscription.status === "CANCELLED" && cancellation.userErrors?.length === 0
    ? "accepted" : "failed";
}
