import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import sessionDb from "../db.server";
import { purgeMerchantShopData } from "../merchant-db.server";

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
    const deletedSessions = await sessionDb.session.deleteMany({
      where: { shop },
    });
    console.log(`Deleted ${deletedSessions.count} sessions`);

    console.log(`✅ Successfully deleted all data for shop: ${shop}`);

  } catch (error) {
    console.error(`Error during shop redact for ${shop}:`, error);
    // Still return 200 to acknowledge the webhook
  }

  return new Response(null, { status: 200 });
};
