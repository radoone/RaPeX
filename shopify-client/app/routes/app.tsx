import { Link, Outlet, isRouteErrorResponse, useLoaderData, useRouteError } from "react-router";
import { NavMenu } from "@shopify/app-bridge-react";
import { data as json } from "react-router";
import { useTranslation } from "react-i18next";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../merchant-db.server";
import { getBillingStatus, requireActiveBilling } from "../services/billing.server";

export const headers = (headersArgs: any) => {
  return boundary.headers(headersArgs);
};

export const loader = async ({ request }: { request: Request }) => {
  const { billing, session } = await authenticate.admin(request);
  const billingRedirect = await requireActiveBilling(billing, session.shop, {
    allowFreeInitialScan: true,
  });
  if (billingRedirect) return billingRedirect as never;

  const billingStatus = await getBillingStatus(billing, session.shop);

  const activeAlertsCount = await db.safetyAlert.count({
    where: {
      shop: session.shop,
      status: 'active',
    },
  });

  return json({ activeAlertsCount, billingStatus });
};

export default function App() {
  const { activeAlertsCount, billingStatus } = useLoaderData<typeof loader>();
  const { t } = useTranslation();

  return (
    <>
      <NavMenu>
        <Link to="/app" rel="home">{t('nav.dashboard')}</Link>
        <Link to="/app/alerts">
          {t('nav.safetyAlerts')} {activeAlertsCount > 0 ? `(${activeAlertsCount})` : ''}
        </Link>
        <Link to="/app/manual-check">{t('nav.catalogCoverage')}</Link>
        <Link to="/app/evidence">{t('nav.evidence')}</Link>
        <Link to="/app/settings">{t('nav.settings')}</Link>
      </NavMenu>
      {!billingStatus.hasActivePayment && !billingStatus.freeScanUsed && (
        <div style={{ padding: "0 var(--s-space-400)", maxWidth: "1200px", margin: "12px auto 0" }}>
          <s-banner tone="info" heading={t("billing.freeScanAvailableHeading")}>
            <s-text>{t("billing.freeScanAvailableDescription")}</s-text>
          </s-banner>
        </div>
      )}
      <Outlet />
    </>
  );
}

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  const error = useRouteError();
  const { t } = useTranslation();

  if (isRouteErrorResponse(error) && (error.status === 200 || !error.statusText)) {
    return boundary.error(error);
  }

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
