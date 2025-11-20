import { Link, Outlet, useLoaderData, useRouteError } from "@remix-run/react";
import { boundary } from "@shopify/shopify-app-remix/server";
import { NavMenu } from "@shopify/app-bridge-react";
import { json } from "@remix-run/node";
import { useTranslation } from "react-i18next";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const loader = async ({ request }: { request: Request }) => {
  const { session } = await authenticate.admin(request);

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
        <Link to="/app/guide">{t('nav.quickGuide')}</Link>
        <Link to="/app/settings">{t('nav.settings')}</Link>
      </NavMenu>
      <Outlet />
    </>
  );
}

// Shopify needs Remix to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}
