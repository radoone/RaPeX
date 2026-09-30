import type { LoaderFunctionArgs } from "react-router";
import { data as json } from "react-router";
import { useLoaderData } from "react-router";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  if (url.searchParams.get("billingError") === "1") {
    return json({ target: null, verificationError: true });
  }
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

  return json({ target: parsedTarget.toString(), verificationError: false });
};

export default function BillingRedirect() {
  const { target, verificationError } = useLoaderData<typeof loader>();
  const { t } = useTranslation();

  useEffect(() => {
    if (target) window.open(target, "_top");
  }, [target]);

  return (
    <s-page suppressHydrationWarning>
      <s-section padding="base">
        <s-stack gap="base" alignItems="center">
          {verificationError ? (
            <s-banner tone="warning" heading={t("billing.statusUnverified")}>
              <s-text>{t("billing.verificationError")}</s-text>
              <div style={{ marginTop: "var(--s-space-300)" }}>
                <s-button variant="primary" href="/app/settings">{t("actions.retry")}</s-button>
              </div>
            </s-banner>
          ) : (
            <>
              <s-spinner size="large" suppressHydrationWarning />
              <s-text tone="subdued">{t("billingRedirect.opening")}</s-text>
              {target ? <s-link href={target} target="_top">{t("billingRedirect.openPricingPlans")}</s-link> : null}
            </>
          )}
        </s-stack>
      </s-section>
    </s-page>
  );
}
