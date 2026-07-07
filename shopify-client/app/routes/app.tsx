import { Link, Outlet, isRouteErrorResponse, useLoaderData, useRouteError } from "react-router";
import { NavMenu } from "@shopify/app-bridge-react";
import { data as json } from "react-router";
import { useTranslation } from "react-i18next";
import { authenticate } from "../shopify.server";
import db from "../merchant-db.server";
import { requireActiveBilling } from "../services/billing.server";

export const loader = async ({ request }: { request: Request }) => {
  const { billing, session } = await authenticate.admin(request);
  const billingRedirect = await requireActiveBilling(billing, session.shop);
  if (billingRedirect) return billingRedirect as never;

  const activeAlertsCount = await db.safetyAlert.count({
    where: {
      shop: session.shop,
      status: 'active',
    },
  });

  return json({ activeAlertsCount });
};

export default function App() {
  const { activeAlertsCount } = useLoaderData<typeof loader>();
  const { t } = useTranslation();

  return (
    <>
      <NavMenu>
        <Link to="/app" rel="home">
          {t('nav.dashboard')}
        </Link>
        <Link to="/app/alerts">
          {t('nav.safetyAlerts')} {activeAlertsCount > 0 ? `(${activeAlertsCount})` : ''}
        </Link>
        <Link to="/app/manual-check">{t('nav.manualCheck')}</Link>
        <Link to="/app/evidence">{t('nav.evidence')}</Link>
        <Link to="/app/settings">{t('nav.settings')}</Link>
      </NavMenu>
      <Outlet />
    </>
  );
}

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  const error = useRouteError();
  const { t } = useTranslation();

  const message = isRouteErrorResponse(error)
    ? typeof error.data === "string"
      ? error.data
      : error.statusText || "Request failed."
    : error instanceof Error
      ? error.message
      : t("errors.unknown");

  return (
    <s-page suppressHydrationWarning>
      <s-section padding="base">
        <s-box
          padding="large"
          borderRadius="large"
          background="bg-surface"
          borderWidth="base"
          borderColor="border"
        >
          <s-stack gap="medium">
            <s-heading size="medium">{t("errors.pageLoadFailed")}</s-heading>
            <s-text tone="subdued">{message}</s-text>
            <div style={{ marginTop: "var(--s-space-200)" }}>
              <s-button onClick={() => window.location.reload()} suppressHydrationWarning>
                {t("actions.retry")}
              </s-button>
            </div>
          </s-stack>
        </s-box>
      </s-section>
    </s-page>
  );
}
