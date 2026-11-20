import type { ActionFunctionArgs } from "react-router";
import { firestore } from "../firestore.server";
import { authenticate } from "../shopify.server";
import { normalizeInterfaceLanguage } from "../services/interface-language";
import { notificationLanguageSelection } from "../services/notification-language";

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") return new Response(null, { status: 405 });
  const { session } = await authenticate.admin(request);
  const data = await request.json().catch(() => null);
  const language = typeof data?.language === "string" ? normalizeInterfaceLanguage(data.language) : undefined;
  if (!language) return new Response(null, { status: 400 });

  const merchant = firestore.collection("merchants").doc(encodeURIComponent(session.shop));
  await firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(merchant);
    const settings = snapshot.data();
    if (!settings || notificationLanguageSelection(settings) !== "app") return;
    if (settings.notificationLanguage === language && settings.notificationLanguageSource === "app") return;
    transaction.update(merchant, { notificationLanguage: language, notificationLanguageSource: "app" });
  });
  return new Response(null, { status: 204 });
};
