import { Link, Outlet, isRouteErrorResponse, useLoaderData, useRouteError } from "react-router";
import { NavMenu } from "@shopify/app-bridge-react";
import { data as json } from "react-router";
import { useTranslation } from "react-i18next";
import { useEffect } from "react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate, ensureShopifyWebhooksRegistered } from "../shopify.server";
import db from "../merchant-db.server";
import { getBillingStatus } from "../services/billing.server";
import { isWaitingForSupplier } from "../services/review-evidence";
import { preferredInterfaceLanguage } from "../services/interface-language";

export const headers = (headersArgs: any) => {
  return boundary.headers(headersArgs);
};

export const loader = async ({ request }: { request: Request }) => {
  const { billing, session, admin } = await authenticate.admin(request);
  await ensureShopifyWebhooksRegistered(session);
  const [billingStatus, activeAlerts] = await Promise.all([
    getBillingStatus(billing, session.shop, admin),
    db.safetyAlert.findMany({
      where: { shop: session.shop, status: "active" },
      select: { status: true, reviewState: true, resolutionType: true },
    }),
  ]);
  const activeAlertsCount = activeAlerts.filter(alert => !isWaitingForSupplier(alert)).length;
  const shopifyLocale = new URL(request.url).searchParams.get("locale") || undefined;
  return json({ activeAlertsCount, billingStatus, shopifyLocale });
};

export default function App() {
  const { activeAlertsCount, billingStatus, shopifyLocale } = useLoaderData<typeof loader>();
  const { t, i18n } = useTranslation();
  const numbers = new Intl.NumberFormat(i18n.resolvedLanguage || i18n.language);

  useEffect(() => {
    let lastLanguage: string | undefined;
    let request = Promise.resolve();
    const sync = (language: string) => {
      if (language === lastLanguage) return;
      lastLanguage = language;
      request = request.then(async () => {
        const response = await fetch("/api/notification-language", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ language }),
        });
        if (!response.ok) throw new Error("Notification language was not saved");
      }).catch(() => {
        if (lastLanguage === language) lastLanguage = undefined;
      });
    };
    sync(preferredInterfaceLanguage(shopifyLocale));
    i18n.on("languageChanged", sync);
    return () => i18n.off("languageChanged", sync);
  }, [i18n, shopifyLocale]);

  return (
    <>
      <NavMenu>
        <Link to="/app" rel="home">{t("redesign.overview")}</Link>
        <Link to="/app/alerts">
          {t("redesign.potentialMatches")} {activeAlertsCount > 0 ? `(${numbers.format(activeAlertsCount)})` : ''}
        </Link>
        <Link to="/app/manual-check">
          {t("nav.catalogCoverage")}
        </Link>
        <Link to="/app/evidence?view=scans">{t("redesign.scanHistory")}</Link>
        <Link to="/app/settings">{t('nav.settings')}</Link>
      </NavMenu>
      {billingStatus.ownerTestAccess && <s-banner tone="info" heading={t("ownerTestAccess")} />}
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
