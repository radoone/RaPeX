import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import db from "../db.server";

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
    // Delete all safety alerts for this shop
    const deletedAlerts = await db.safetyAlert.deleteMany({
      where: { shop },
    });
    console.log(`Deleted ${deletedAlerts.count} safety alerts`);

    // Delete all safety checks for this shop
    const deletedChecks = await db.safetyCheck.deleteMany({
      where: { shop },
    });
    console.log(`Deleted ${deletedChecks.count} safety checks`);

    // Delete all webhook errors for this shop
    const deletedErrors = await db.webhookError.deleteMany({
      where: { shop },
    });
    console.log(`Deleted ${deletedErrors.count} webhook errors`);

    // Delete safety settings for this shop
    const deletedSettings = await db.safetySetting.deleteMany({
      where: { shop },
    });
    console.log(`Deleted ${deletedSettings.count} safety settings`);

    // Delete sessions for this shop
    const deletedSessions = await db.session.deleteMany({
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

