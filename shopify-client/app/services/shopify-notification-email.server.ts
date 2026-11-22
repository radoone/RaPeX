export const notificationEmailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Prefer the contact set on the store. Keep the shop email as a separate lookup. */
export async function getShopifyNotificationEmail(admin: {
  graphql(query: string): Promise<Response>;
}): Promise<string | null> {
  for (const [field, query] of [
    ["contactEmail", `#graphql
      query NotificationContactEmail { shop { contactEmail } }
    `],
    ["email", `#graphql
      query NotificationShopEmail { shop { email } }
    `],
  ] as const) {
    try {
      const response = await admin.graphql(query);
      if (!response.ok) continue;
      const payload = await response.json();
      const value = payload?.data?.shop?.[field];
      if (typeof value !== "string") continue;
      const email = value.trim().toLowerCase();
      if (notificationEmailPattern.test(email)) return email;
    } catch {
      // The remaining shop field can still be available.
    }
  }
  return null;
}
