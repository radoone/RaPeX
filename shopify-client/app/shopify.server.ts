import "@shopify/shopify-app-react-router/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  DeliveryMethod,
  shopifyApp,
} from "@shopify/shopify-app-react-router/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server";
import { FirestoreSessionStorage } from "./firestore-session-storage.server";
import { firestore } from "./firestore.server";
import { FieldValue } from "firebase-admin/firestore";

const configuredSessionStorage = process.env.SHOPIFY_SESSION_STORAGE === "firestore"
  ? new FirestoreSessionStorage(firestore)
  : new PrismaSessionStorage(prisma);

export const SHOPIFY_BILLING_TEST = process.env.SHOPIFY_BILLING_TEST !== "false";
export const SHOPIFY_APP_HANDLE = process.env.SHOPIFY_APP_HANDLE || "";
export const SHOPIFY_BILLING_MODE = process.env.SHOPIFY_BILLING_MODE || "app-pricing";
export const SHOPIFY_PARTNER_ORG_ID = process.env.SHOPIFY_PARTNER_ORG_ID || "";
export const SHOPIFY_PARTNER_API_TOKEN = process.env.SHOPIFY_PARTNER_API_TOKEN || "";
export const SHOPIFY_APP_GID = process.env.SHOPIFY_APP_GID || "";
export const SHOPIFY_PARTNER_API_VERSION = process.env.SHOPIFY_PARTNER_API_VERSION || "2026-07";
export const SHOPIFY_BILLING_BYPASS =
  process.env.NODE_ENV !== "production" && process.env.SHOPIFY_BILLING_BYPASS !== "false";

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion: ApiVersion.July26,
  scopes: process.env.SCOPES?.split(","),
  appUrl: process.env.SHOPIFY_APP_URL || "",
  authPathPrefix: "/auth",
  sessionStorage: configuredSessionStorage,
  distribution: AppDistribution.AppStore,
  hooks: {
    afterAuth: async ({ session }) => {
      await ensureShopifyWebhooksRegistered(session);
    },
  },
  webhooks: {
    PRODUCTS_CREATE: {
      deliveryMethod: DeliveryMethod.Http,
      callbackUrl: "/webhooks/products/create",
    },
    PRODUCTS_UPDATE: {
      deliveryMethod: DeliveryMethod.Http,
      callbackUrl: "/webhooks/products/update",
    },
    APP_UNINSTALLED: {
      deliveryMethod: DeliveryMethod.Http,
      callbackUrl: "/webhooks/app/uninstalled",
    },
    // GDPR mandatory webhooks
    CUSTOMERS_DATA_REQUEST: {
      deliveryMethod: DeliveryMethod.Http,
      callbackUrl: "/webhooks/customers/data_request",
    },
    CUSTOMERS_REDACT: {
      deliveryMethod: DeliveryMethod.Http,
      callbackUrl: "/webhooks/customers/redact",
    },
    SHOP_REDACT: {
      deliveryMethod: DeliveryMethod.Http,
      callbackUrl: "/webhooks/shop/redact",
    },
  },
  ...(process.env.SHOP_CUSTOM_DOMAIN
    ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
    : {}),
});

const WEBHOOK_REGISTRATION_VERSION = "product-events-2026-07-v1";

/** Register app-managed subscriptions after OAuth and restore them on existing sessions. */
export async function ensureShopifyWebhooksRegistered(
  session: Parameters<typeof shopify.registerWebhooks>[0]["session"],
): Promise<void> {
  const merchantRef = firestore.collection("merchants").doc(encodeURIComponent(session.shop));
  const merchantSnapshot = await merchantRef.get();
  if (merchantSnapshot.get("webhookRegistrationVersion") === WEBHOOK_REGISTRATION_VERSION) return;

  const registrations = await shopify.registerWebhooks({ session });
  if (!registrations) throw new Error("Shopify did not confirm webhook registration");
  const failures = Object.values(registrations || {}).flat().filter((result) => !result.success);
  if (failures.length > 0) {
    throw new Error(`Shopify webhook registration failed for ${failures.length} subscription(s)`);
  }
  await merchantRef.set({
    shop: session.shop,
    webhookRegistrationVersion: WEBHOOK_REGISTRATION_VERSION,
    webhooksRegisteredAt: FieldValue.serverTimestamp(),
  }, { merge: true });
}

export default shopify;
export const apiVersion = ApiVersion.July26;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;
