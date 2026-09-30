import type { ActionFunctionArgs } from "react-router";
import { authenticate, sessionStorage } from "../shopify.server";
import { purgeMerchantShopData } from "../merchant-db.server";
import { deleteCatalogAuditSessions } from "../services/catalog-audit-session.server";

/**
 * GDPR webhook: shop/redact
 * Shopify sends this 48 hours after a store uninstalls the app.
 * We must delete all data associated with this shop.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);
  console.log("Shop redact request - deleting all data for:", shop);

  try {
    const deleted = await purgeMerchantShopData(shop);
    console.log(`Deleted ${deleted.alerts} safety alerts`);
    console.log(`Deleted ${deleted.checks} safety checks`);
    console.log(`Deleted ${deleted.webhookErrors} webhook errors`);
    console.log(`Deleted ${deleted.settings} safety settings`);
    console.log(`Deleted ${deleted.products} merchant products`);
    console.log(`Deleted ${deleted.monitorState} monitor state docs`);

    // Delete sessions for this shop
    const shopSessions = await sessionStorage.findSessionsByShop(shop);
    await sessionStorage.deleteSessions(shopSessions.map((item) => item.id));
    const workerSessions = await deleteCatalogAuditSessions(shop);
    console.log(`Deleted ${shopSessions.length + workerSessions} sessions`);

    console.log(`✅ Successfully deleted all data for shop: ${shop}`);

  } catch (error) {
    console.error(`Error during shop redact for ${shop}:`, error);
    // Return a retryable response so Shopify does not treat failed deletion as complete.
    return new Response(null, { status: 500 });
  }

  return new Response(null, { status: 200 });
};
