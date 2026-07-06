import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const target = url.searchParams.get("to") || "";
  const parsedTarget = new URL(target);

  if (
    parsedTarget.protocol !== "https:" ||
    parsedTarget.hostname !== "admin.shopify.com" ||
    !parsedTarget.pathname.includes("/charges/") ||
    !parsedTarget.pathname.endsWith("/pricing_plans")
  ) {
    throw new Response("Invalid billing redirect target.", { status: 400 });
  }

  return json({ target: parsedTarget.toString() });
};

export default function BillingRedirect() {
  const { target } = useLoaderData<typeof loader>();
  const { t } = useTranslation();

  useEffect(() => {
    window.open(target, "_top");
  }, [target]);

  return (
    <s-page suppressHydrationWarning>
      <s-section padding="base">
        <s-stack gap="base" alignItems="center">
          <s-spinner size="large" suppressHydrationWarning />
          <s-text tone="subdued">{t("billingRedirect.opening")}</s-text>
          <s-link href={target} target="_top">
            {t("billingRedirect.openPricingPlans")}
          </s-link>
        </s-stack>
      </s-section>
    </s-page>
  );
}
