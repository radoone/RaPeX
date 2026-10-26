import { AdminCard } from "../components/AdminCard";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { data as json, redirect } from "react-router";
import {
  useActionData,
  useLoaderData,
  useNavigation,
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
    envDefault: fallbackDefault,
    billingStatus,
    shopifyContactEmail,
  });
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
  const { settings, billingStatus, catalog, saved } =
    useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const { t } = useTranslation();
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
  const [values, setValues] = useState(initial);
  useEffect(() => {
    setValues({
      threshold: String(settings.similarityThreshold ?? 70),
      priority: settings.autoDraftHighRisk ?? false,
      immediate:
        settings.immediateAlertEmails ?? settings.emailNotifications ?? true,
      weekly:
        settings.weeklySummaryEmails ?? settings.emailNotifications ?? true,
      email: settings.notificationEmail || "",
      language: settings.notificationLanguage || "en",
      vendors: settings.excludeVendors || "",
      types: settings.excludeTypes || "",
    });
  }, [settings]);
  const dirty = JSON.stringify(values) !== JSON.stringify(initial);
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
  return (
    <s-page size="large" className="page-shell">
      <s-heading slot="title">{t("settings.title")}</s-heading>
      <div className="admin-stack">
        <MonitoringStatus billing={billingStatus} />
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
          <div className="settings-save-bar">
            <span role="status">
              {dirty ? t("workspace.unsaved") : t("settings.title")}
            </span>
            <s-button
              type="submit"
              variant="primary"
              disabled={!dirty || busy}
              loading={busy}
            >
              {t("workspace.saveChanges")}
            </s-button>
          </div>
          <div className="admin-section-grid admin-section-grid--wide">
            <AdminCard className="admin-card admin-stack">
              <h2 className="admin-card__title">
                {t("settingsAdmin.notifications.enabledTitle")}
              </h2>
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
                {t("settingsAdmin.notifications.weeklyDescription")}
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
            </AdminCard>
            <div className="admin-stack">
              <AdminCard className="admin-card">
                <h2 className="admin-card__title">
                  {t("workspace.appLanguage")}
                </h2>
                <LanguageSwitcher />
              </AdminCard>
              <AdminCard className="admin-card admin-stack">
                <h2 className="admin-card__title">{t("billing.planTitle")}</h2>
                <p>
                  {billingStatus.developmentBypass
                    ? t("billing.statusDevelopmentBypass")
                    : !billingStatus.billingVerified
                      ? t("billing.verificationError")
                      : billingStatus.hasActivePayment
                        ? t("billing.statusActivePro")
                        : t(
                            billingStatus.freeScanUsed
                              ? "billing.statusFreeUsed"
                              : "billing.statusFreeAvailable",
                          )}
                </p>
                <p className="admin-helper">{t("experience.valueBody")}</p>
                {billingStatus.pricingPlansUrl && (
                  <s-button
                    type="button"
                    onClick={() =>
                      window.open(billingStatus.pricingPlansUrl!, "_top")
                    }
                  >
                    {t("billing.managePlanButton")}
                  </s-button>
                )}
              </AdminCard>
            </div>
          </div>
          <AdminCard className="admin-card">
            <h2 className="admin-card__title">{t("workspace.recommended")}</h2>
            <p>{t("workspace.balancedHelp")}</p>
            <s-badge tone="info">{t(`settingsAdmin.mode.${mode}`)}</s-badge>
          </AdminCard>
          <AdminCard className="admin-card">
            <details className="advanced-settings-disclosure">
              <summary>{t("workspace.settingsAdvanced")}</summary>
              <div className="admin-stack">
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
