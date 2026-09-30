import type { ActionFunctionArgs } from "react-router";
import { authenticate, sessionStorage } from "../shopify.server";
import { purgeMerchantShopData } from "../merchant-db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  // Webhook requests can trigger multiple times after the app is uninstalled.
  // Find first because the webhook's own session may already have been removed.
  const sessions = await sessionStorage.findSessionsByShop(shop);
  await sessionStorage.deleteSessions(sessions.map((item) => item.id));

  try {
    await purgeMerchantShopData(shop);
  } catch (error) {
    console.error("Failed to purge merchant data on uninstall", { shop, error });
    return new Response(null, { status: 500 });
  }

  return new Response();
};
