import { AdminCard } from "../components/AdminCard";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { data as json, redirect } from "react-router";
import {
  useActionData,
  useLoaderData,
  useNavigation,
  useRevalidator,
  Form,
  useRouteError,
  isRouteErrorResponse,
} from "react-router";
import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { authenticate } from "../shopify.server";
import db from "../merchant-db.server";
import { LanguageSwitcher } from "../components";
import { MonitoringStatus } from "../components/MonitoringStatus";
import { exclusionPreview } from "../services/exclusion-preview";
import { getBillingStatus } from "../services/billing.server";
import { EU_LANGUAGES } from "../locales/languages";
import { firestore } from "../firestore.server";
import { getRecentMonitoringRuns } from "../services/monitoring-runs.server";
import { toIsoString } from "../services/monitoring-runs";
import { monitoringState } from "../services/monitoring-state";
import { displayShopifyPlan } from "../services/partner-entitlement";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SUPPORTED_LANGUAGES = new Set(
  EU_LANGUAGES.map((language) => language.code),
);

async function getShopifyContactEmail(admin: any): Promise<string | null> {
  const response = await admin.graphql(`#graphql
    query notificationContactEmail {
      shop { contactEmail email }
    }
  `);
  const payload = await response.json();
  const value = String(
    payload.data?.shop?.contactEmail || payload.data?.shop?.email || "",
  )
    .trim()
    .toLowerCase();
  return EMAIL_PATTERN.test(value) ? value : null;
}

export const loader = async ({ request, url }: LoaderFunctionArgs) => {
  const { admin, billing, session } = await authenticate.admin(request);
  const billingStatus = await getBillingStatus(billing, session.shop, admin);
  const [monitorSnapshot, runs] = await Promise.all([
    firestore.collection("merchants").doc(encodeURIComponent(session.shop)).get().catch(() => null),
    getRecentMonitoringRuns(session.shop).catch(() => []),
  ]);
  const monitor = monitorSnapshot?.exists ? monitorSnapshot.data() : null;
  const lastMonitoringAt = runs.find((run) => run.status === "completed" && run.updatedAt)?.updatedAt ||
    (monitor?.lastMonitorStatus === "SUCCESS" ? toIsoString(monitor.lastMonitorRunEnd) : null);
  const latestRunStatus = runs[0]?.status === "completed"
    ? monitor?.lastMonitorStatus || null
    : runs[0]?.status || monitor?.lastMonitorStatus || null;
  const observedAt = Date.now();
  const entitlementExpiry = toIsoString(monitor?.subscriptionValidUntil);
  const emailDelivery = !monitorSnapshot ? "unconfirmed" : monitor?.installationRetiredAt ? "paused" :
    billingStatus.ownerTestAccess || (
      monitor?.subscriptionStatus === "active" &&
      monitor.monitoringEntitled === true &&
      entitlementExpiry && Date.parse(entitlementExpiry) > observedAt
    ) ? "eligible" : "paused";
  const automaticMonitoring = monitoringState(billingStatus, latestRunStatus, observedAt, lastMonitoringAt);

  let settings = await db.safetySetting.findUnique({
    where: { shop: session.shop },
  });

  const envDefault = Number(
    process.env.SAFETY_GATE_SIMILARITY_THRESHOLD || "0",
  );
  const fallbackDefault = Number.isFinite(envDefault) ? envDefault : 70;

  const shopifyContactEmail = await getShopifyContactEmail(admin).catch(
    (error) => {
      console.warn(
        "Could not load Shopify contact email for notifications",
        error,
      );
      return null;
    },
  );

  if (
    !settings ||
    settings.emailNotifications === undefined ||
    settings.immediateAlertEmails === undefined ||
    settings.weeklySummaryEmails === undefined ||
    !settings.notificationEmail
  ) {
    settings = await db.safetySetting.upsert({
      where: { shop: session.shop },
      update: {
        ...(settings?.emailNotifications === undefined
          ? { emailNotifications: true }
          : {}),
        ...(settings?.immediateAlertEmails === undefined
          ? { immediateAlertEmails: settings?.emailNotifications !== false }
          : {}),
        ...(settings?.weeklySummaryEmails === undefined
          ? { weeklySummaryEmails: settings?.emailNotifications !== false }
          : {}),
        ...(!settings?.notificationEmail && shopifyContactEmail
          ? {
              notificationEmail: shopifyContactEmail,
              notificationEmailSource: "shopify" as const,
            }
          : {}),
        ...(!settings?.notificationLanguage
          ? { notificationLanguage: "en" }
          : {}),
      },
      create: {
        shop: session.shop,
        similarityThreshold: fallbackDefault,
        autoDraftHighRisk: false,
        emailNotifications: true,
        immediateAlertEmails: true,
        weeklySummaryEmails: true,
        notificationEmail: shopifyContactEmail,
        notificationEmailSource: "shopify",
        notificationLanguage: "en",
        excludeVendors: null,
        excludeTypes: null,
      },
    });
  }

  const catalog: Array<{
    id: string;
    title: string;
    vendor: string;
    productType: string;
  }> = [];
  let cursor: string | null = null;
  do {
    const response: any = await admin.graphql(
      `#graphql
      query exclusionPreview($after: String) { products(first: 250, after: $after) { nodes { id title vendor productType } pageInfo { hasNextPage endCursor } } }
    `,
      { variables: { after: cursor } },
    );
    const payload = await response.json();
    if (payload.errors?.length || !payload.data?.products)
      throw new Error("Could not load exclusion preview");
    catalog.push(...payload.data.products.nodes);
    const pageInfo = payload.data.products.pageInfo;
    if (pageInfo.hasNextPage && !pageInfo.endCursor)
      throw new Error("Shopify catalog cursor is missing");
    cursor = pageInfo.hasNextPage ? pageInfo.endCursor : null;
  } while (cursor);
  return json({
    catalog,
    saved: url.searchParams.get("saved") === "1",
    settings: settings || {
      similarityThreshold: fallbackDefault,
      autoDraftHighRisk: false,
      emailNotifications: true,
      immediateAlertEmails: true,
      weeklySummaryEmails: true,
      notificationEmail: shopifyContactEmail,
      notificationEmailSource: "shopify",
      notificationLanguage: "en",
      excludeVendors: null,
      excludeTypes: null,
    },
    billingStatus,
    lastMonitoringAt,
    automaticMonitoring,
    emailDelivery,
    lastVerifiedPlan: displayShopifyPlan(monitor?.planHandle),
  } as const);
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();

  const threshold = Number(formData.get("similarityThreshold"));
  const similarityThreshold = Number.isFinite(threshold)
    ? Math.min(Math.max(Math.round(threshold), 0), 100)
    : 70;

  const autoDraftHighRisk = formData.get("autoDraftHighRisk") === "true";
  const immediateAlertEmails = formData.get("immediateAlertEmails") === "true";
  const weeklySummaryEmails = formData.get("weeklySummaryEmails") === "true";
  const emailNotifications = immediateAlertEmails || weeklySummaryEmails;
  const notificationEmail = String(formData.get("notificationEmail") || "")
    .trim()
    .toLowerCase();
  const requestedLanguage = String(
    formData.get("notificationLanguage") || "en",
  );
  const notificationLanguage = SUPPORTED_LANGUAGES.has(requestedLanguage as any)
    ? requestedLanguage
    : "en";
  if (emailNotifications && !EMAIL_PATTERN.test(notificationEmail)) {
    return json({ error: "invalid_notification_email" }, { status: 400 });
  }
  const excludeVendors = (formData.get("excludeVendors") as string) || null;
  const excludeTypes = (formData.get("excludeTypes") as string) || null;

  await db.safetySetting.upsert({
    where: { shop: session.shop },
    update: {
      similarityThreshold,
      autoDraftHighRisk,
      emailNotifications,
      immediateAlertEmails,
      weeklySummaryEmails,
      notificationEmail: notificationEmail || null,
      notificationEmailSource: "custom",
      notificationLanguage,
      excludeVendors,
      excludeTypes,
    },
    create: {
      shop: session.shop,
      similarityThreshold,
      autoDraftHighRisk,
      emailNotifications,
      immediateAlertEmails,
      weeklySummaryEmails,
      notificationEmail: notificationEmail || null,
      notificationEmailSource: "custom",
      notificationLanguage,
      excludeVendors,
      excludeTypes,
    },
  });

  return redirect("/app/settings?saved=1");
};

export function ErrorBoundary() {
  const error = useRouteError();
  const { t } = useTranslation();

  const title = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : error instanceof Error
      ? error.message
      : t("common.unknown");

  return (
    <s-page suppressHydrationWarning>
      <s-heading slot="title" size="large" suppressHydrationWarning>
        {t("settings.title")}
      </s-heading>
      <div className="admin-stack" style={{ marginTop: "var(--s-space-400)" }}>
        <s-banner tone="critical" heading={t("errors.pageLoadFailed")}>
          <s-text>{title}</s-text>
          <div style={{ marginTop: "var(--s-space-200)" }}>
            <s-button
              onClick={() => window.location.reload()}
              suppressHydrationWarning
            >
              {t("actions.retry")}
            </s-button>
          </div>
        </s-banner>
      </div>
    </s-page>
  );
}

export default function Settings() {
  const { settings, billingStatus, catalog, saved, lastMonitoringAt, automaticMonitoring, emailDelivery, lastVerifiedPlan } =
    useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const revalidator = useRevalidator();
  const { t, i18n } = useTranslation();
  const initial = {
    threshold: String(settings.similarityThreshold ?? 70),
    priority: settings.autoDraftHighRisk ?? false,
    immediate:
      settings.immediateAlertEmails ?? settings.emailNotifications ?? true,
    weekly: settings.weeklySummaryEmails ?? settings.emailNotifications ?? true,
    email: settings.notificationEmail || "",
    language: settings.notificationLanguage || "en",
    vendors: settings.excludeVendors || "",
    types: settings.excludeTypes || "",
  };
  const savedValues = JSON.stringify(initial);
  const [values, setValues] = useState(initial);
  useEffect(() => {
    setValues(JSON.parse(savedValues) as typeof initial);
  }, [savedValues]);
  const dirty = JSON.stringify(values) !== savedValues;
  const busy = navigation.state !== "idle";
  const change = <K extends keyof typeof values>(
    key: K,
    value: (typeof values)[K],
  ) => setValues((current) => ({ ...current, [key]: value }));
  const excluded = exclusionPreview(catalog, values.vendors, values.types);
  const mode =
    Number(values.threshold) < 60
      ? "broad"
      : Number(values.threshold) <= 75
        ? "balanced"
        : "strict";
  const planVerified = billingStatus.billingVerified && !billingStatus.ownerTestAccess && !billingStatus.developmentBypass;
  const planName = billingStatus.ownerTestAccess ? t("settingsOverview.testAccess")
    : billingStatus.developmentBypass ? t("catalogOverview.monitoring.preview")
    : !planVerified ? t("settingsOverview.planUnverified")
    : billingStatus.hasActivePayment ? displayShopifyPlan(billingStatus.planHandle) || t("settingsOverview.activePlan")
    : t("settingsOverview.noActivePlan");
  const showLastPlan = !planVerified && !billingStatus.ownerTestAccess && !billingStatus.developmentBypass && lastVerifiedPlan;
  const sendsEmail = initial.immediate || initial.weekly;
  const emails = [
    ["settingsAdmin.notifications.immediateTitle", initial.immediate],
    ["settingsOverview.mondayEmail", initial.weekly],
  ] as const;
  const refreshStatusAvailable = automaticMonitoring === "unknown" || automaticMonitoring === "unverified";
  const planButtonLabel = planVerified && !billingStatus.hasActivePayment
    ? t("billingRedirect.openPricingPlans") : t("billing.managePlanButton");

  return (
    <s-page size="large" className="page-shell">
      <s-heading slot="title">{t("settings.title")}</s-heading>
      <div className="admin-stack">
        <AdminCard className="admin-card">
          <div className="settings-overview">
            <section className="settings-overview__panel">
              <h2>{t("billing.statusLabel")}</h2>
              <div className="settings-overview__plan">
                <strong>{planName}</strong>
                {planVerified && billingStatus.hasActivePayment && (
                  <s-badge tone="success">{t("settingsOverview.active")}</s-badge>
                )}
              </div>
              {showLastPlan && (
                <p className="admin-helper">{t("settingsOverview.previousPlan", { plan: lastVerifiedPlan })}</p>
              )}
              {planVerified && !billingStatus.hasActivePayment && !billingStatus.freeScanUsed && (
                <p className="admin-helper">{t("billing.planFreeAvailableDescription")}</p>
              )}
              {billingStatus.pricingPlansUrl && (
                <s-link href={billingStatus.pricingPlansUrl} target="_top">{planButtonLabel}</s-link>
              )}
            </section>
            <MonitoringStatus state={automaticMonitoring} lastSuccess={lastMonitoringAt} />
            <section className="settings-overview__panel">
              <h2>{t("settingsAdmin.notifications.enabledTitle")}</h2>
              <dl className="settings-overview__emails">
                {emails.map(([label, enabled]) => (
                  <div key={label}>
                    <dt>{t(label)}</dt>
                    <dd>
                      <s-badge tone={enabled ? "success" : "subdued"}>
                        {t(enabled ? "settingsOverview.on" : "settingsOverview.off")}
                      </s-badge>
                    </dd>
                  </div>
                ))}
              </dl>
              {sendsEmail && initial.email && (
                <p className="admin-helper">{t("settingsOverview.recipient", { email: initial.email })}</p>
              )}
              {sendsEmail && !initial.email && (
                <p className="admin-helper">{t("settingsAdmin.notifications.noRecipientDescription")}</p>
              )}
              {sendsEmail && initial.email && emailDelivery !== "eligible" && (
                <p className="admin-helper">{t(`settingsOverview.delivery.${emailDelivery}`)}</p>
              )}
            </section>
          </div>
          {refreshStatusAvailable && (
            <s-button
              variant="tertiary"
              loading={revalidator.state !== "idle"}
              onClick={() => revalidator.revalidate()}
            >
              {t("catalogOverview.refreshStatus")}
            </s-button>
          )}
        </AdminCard>
        {saved && !dirty && <p role="status">{t("workspace.saved")}</p>}
        {actionData && "error" in actionData && (
          <s-banner
            tone="critical"
            heading={t("settingsAdmin.notifications.invalidEmail")}
          />
        )}
        <Form method="post" className="admin-stack">
          <input
            type="hidden"
            name="similarityThreshold"
            value={values.threshold}
          />
          <input
            type="hidden"
            name="autoDraftHighRisk"
            value={String(values.priority)}
          />
          <input
            type="hidden"
            name="immediateAlertEmails"
            value={String(values.immediate)}
          />
          <input
            type="hidden"
            name="weeklySummaryEmails"
            value={String(values.weekly)}
          />
          <input type="hidden" name="notificationEmail" value={values.email} />
          <input
            type="hidden"
            name="notificationLanguage"
            value={values.language}
          />
          <input type="hidden" name="excludeVendors" value={values.vendors} />
          <input type="hidden" name="excludeTypes" value={values.types} />
          {dirty && (
            <div className="settings-save-bar settings-save-bar--dirty">
              <span role="status">{t("workspace.unsaved")}</span>
              <s-button type="submit" variant="primary" disabled={busy} loading={busy}>
                {t("workspace.saveChanges")}
              </s-button>
            </div>
          )}
          <AdminCard className="admin-card">
            <details className="advanced-settings-disclosure" open={actionData && "error" in actionData ? true : undefined}>
              <summary>{t("settingsOverview.editEmail")}</summary>
              <div className="admin-stack">
                <s-checkbox
                  label={t("settingsAdmin.notifications.immediateTitle")}
                  checked={values.immediate}
                  onChange={(event: any) =>
                    change("immediate", event.currentTarget.checked)
                  }
                />
                <p className="admin-helper">
                  {t("settingsAdmin.notifications.immediateDescription")}
                </p>
                <s-checkbox
                  label={t("settingsAdmin.notifications.weeklyTitle")}
                  checked={values.weekly}
                  onChange={(event: any) =>
                    change("weekly", event.currentTarget.checked)
                  }
                />
                <p className="admin-helper">
                  {t("settingsOverview.weeklyHelp")}
                </p>
                <s-text-field
                  label={t("settingsAdmin.notifications.emailLabel")}
                  type="email"
                  value={values.email}
                  onInput={(event: any) =>
                    change("email", event.currentTarget.value)
                  }
                  required={values.immediate || values.weekly}
                />
                <s-select
                  label={t("workspace.notificationLanguage")}
                  value={values.language}
                  onChange={(event: any) =>
                    change("language", event.currentTarget.value)
                  }
                >
                  {EU_LANGUAGES.map((language) => (
                    <s-option key={language.code} value={language.code}>
                      {language.label}
                    </s-option>
                  ))}
                </s-select>
                {i18n.language.split(/[-_]/)[0] !== values.language && (
                  <p className="admin-helper" role="status">
                    {t("analysis.reviewLayout.languageDiffNote", {
                      appLang:
                        EU_LANGUAGES.find(
                          (l) => l.code === i18n.language.split(/[-_]/)[0],
                        )?.label || i18n.language,
                      emailLang:
                        EU_LANGUAGES.find((l) => l.code === values.language)
                          ?.label || values.language,
                    })}
                  </p>
                )}
              </div>
            </details>
          </AdminCard>
          <AdminCard className="admin-card">
            <details className="advanced-settings-disclosure">
              <summary>{t("workspace.appLanguage")}</summary>
              <LanguageSwitcher />
            </details>
          </AdminCard>
          <AdminCard className="admin-card">
            <details className="advanced-settings-disclosure">
              <summary>{t("workspace.settingsAdvanced")}</summary>
              <div className="admin-stack">
                <p className="admin-helper">{t("workspace.balancedHelp")}</p>
                <div
                  className="monitoring-mode-grid"
                  role="group"
                  aria-label={t("settings.threshold.title")}
                >
                  {(
                    [
                      ["broad", "50"],
                      ["balanced", "70"],
                      ["strict", "85"],
                    ] as const
                  ).map(([name, number]) => (
                    <button
                      key={name}
                      type="button"
                      aria-pressed={mode === name}
                      className={`monitoring-mode-option ${mode === name ? "monitoring-mode-option--active" : ""}`}
                      onClick={() => change("threshold", number)}
                    >
                      <strong>
                        {mode === name ? "✓ " : ""}
                        {t(`settingsAdmin.mode.${name}`)}
                      </strong>
                      <span>{t(`workspace.${name}Help`)}</span>
                    </button>
                  ))}
                </div>
                <s-number-field
                  label={t("settings.threshold.label")}
                  min="0"
                  max="100"
                  value={values.threshold}
                  onChange={(event: any) =>
                    change("threshold", event.currentTarget.value)
                  }
                />
                <s-checkbox
                  label={t("settingsAdmin.automation.autoDraftTitle")}
                  checked={values.priority}
                  onChange={(event: any) =>
                    change("priority", event.currentTarget.checked)
                  }
                />
                <p className="admin-helper">
                  {t("settingsAdmin.automation.autoDraftDescription")}
                </p>
                <h3>{t("settingsAdmin.exclusions.title")}</h3>
                <p>{t("workspace.excludeHelp")}</p>
                <s-text-field
                  label={t("settingsAdmin.exclusions.vendorsTitle")}
                  value={values.vendors}
                  onInput={(event: any) =>
                    change("vendors", event.currentTarget.value)
                  }
                  helpText={t("settingsAdmin.exclusions.vendorsDescription")}
                />
                <s-text-field
                  label={t("settingsAdmin.exclusions.typesTitle")}
                  value={values.types}
                  onInput={(event: any) =>
                    change("types", event.currentTarget.value)
                  }
                  helpText={t("settingsAdmin.exclusions.typesDescription")}
                />
                <p role="status">
                  {t("workspace.excluded", {
                    count: excluded.length,
                    total: catalog.length,
                  })}
                </p>
                {excluded.length > 0 && (
                  <ul>
                    {excluded.slice(0, 10).map((product) => (
                      <li key={product.id}>{product.title}</li>
                    ))}
                  </ul>
                )}
              </div>
            </details>
          </AdminCard>
        </Form>
      </div>
    </s-page>
  );
}
