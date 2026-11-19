import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { firestore } from "../firestore.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { payload, session, topic, shop } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}`);

  const scope = Array.isArray(payload.current)
    ? payload.current.join(",")
    : String(payload.current ?? "");

  if (session) {
    const sessionRef = firestore.collection("shopify_sessions").doc(encodeURIComponent(session.id));
    await firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(sessionRef);
      if (!snapshot.exists) return;
      transaction.update(sessionRef, { scope, updatedAt: new Date() });
    });
  }
  return new Response();
};
