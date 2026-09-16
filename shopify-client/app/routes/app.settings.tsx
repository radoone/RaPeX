import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { data as json, redirect } from "react-router";
import { useActionData, useLoaderData, useNavigation, Form, useRouteError, isRouteErrorResponse } from "react-router";
import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { authenticate } from "../shopify.server";
import db from "../merchant-db.server";
import { LanguageSwitcher } from "../components";
import { getBillingStatus, requireActiveBilling } from "../services/billing.server";
import { EU_LANGUAGES } from "../locales/languages";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SUPPORTED_LANGUAGES = new Set(EU_LANGUAGES.map((language) => language.code));

async function getShopifyContactEmail(admin: any): Promise<string | null> {
  const response = await admin.graphql(`#graphql
    query notificationContactEmail {
      shop { contactEmail email }
    }
  `);
  const payload = await response.json();
  const value = String(payload.data?.shop?.contactEmail || payload.data?.shop?.email || "").trim().toLowerCase();
  return EMAIL_PATTERN.test(value) ? value : null;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, billing, session } = await authenticate.admin(request);
  const billingRedirect = await requireActiveBilling(billing, session.shop, {
    allowFreeInitialScan: true,
  });
  if (billingRedirect) return billingRedirect as never;

  const billingStatus = await getBillingStatus(billing, session.shop);
  let settings = await db.safetySetting.findUnique({
    where: { shop: session.shop },
  });
  
  const envDefault = Number(process.env.SAFETY_GATE_SIMILARITY_THRESHOLD || "0");
  const fallbackDefault = Number.isFinite(envDefault) ? envDefault : 70;

  if (!settings || settings.emailNotifications === undefined || !settings.notificationEmail) {
    const shopifyEmail = await getShopifyContactEmail(admin).catch((error) => {
      console.warn("Could not load Shopify contact email for notifications", error);
      return null;
    });
    settings = await db.safetySetting.upsert({
      where: { shop: session.shop },
      update: {
        ...(settings?.emailNotifications === undefined ? { emailNotifications: true } : {}),
        ...(!settings?.notificationEmail && shopifyEmail ? {
          notificationEmail: shopifyEmail,
          notificationEmailSource: "shopify" as const,
        } : {}),
        ...(!settings?.notificationLanguage ? { notificationLanguage: "en" } : {}),
      },
      create: {
        shop: session.shop,
        similarityThreshold: fallbackDefault,
        autoDraftHighRisk: false,
        emailNotifications: true,
        notificationEmail: shopifyEmail,
        notificationEmailSource: "shopify",
        notificationLanguage: "en",
        excludeVendors: null,
        excludeTypes: null,
      },
    });
  }

  return json({
    settings: settings || {
      similarityThreshold: fallbackDefault,
      autoDraftHighRisk: false,
      emailNotifications: true,
      notificationEmail: null,
      notificationEmailSource: "shopify",
      notificationLanguage: "en",
      excludeVendors: null,
      excludeTypes: null,
    },
    envDefault: fallbackDefault,
    billingStatus,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { billing, session } = await authenticate.admin(request);
  const billingRedirect = await requireActiveBilling(billing, session.shop, {
    allowFreeInitialScan: true,
  });
  if (billingRedirect) return billingRedirect as never;
  const formData = await request.formData();
  
  const threshold = Number(formData.get("similarityThreshold"));
  const similarityThreshold = Number.isFinite(threshold)
    ? Math.min(Math.max(Math.round(threshold), 0), 100)
    : 70;

  const autoDraftHighRisk = formData.get("autoDraftHighRisk") === "true";
  const emailNotifications = formData.get("emailNotifications") === "true";
  const notificationEmail = String(formData.get("notificationEmail") || "").trim().toLowerCase();
  const requestedLanguage = String(formData.get("notificationLanguage") || "en");
  const notificationLanguage = SUPPORTED_LANGUAGES.has(requestedLanguage as any) ? requestedLanguage : "en";
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

  return redirect("/app/settings");
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
      <s-heading slot="title" size="large" suppressHydrationWarning>{t("settings.title")}</s-heading>
      <div className="admin-stack" style={{ marginTop: "var(--s-space-400)" }}>
        <s-banner tone="critical" heading={t("errors.pageLoadFailed")}>
          <s-text>{title}</s-text>
          <div style={{ marginTop: "var(--s-space-200)" }}>
            <s-button onClick={() => window.location.reload()} suppressHydrationWarning>
              {t("actions.retry")}
            </s-button>
          </div>
        </s-banner>
      </div>
    </s-page>
  );
}

export default function Settings() {
  const { settings, envDefault, billingStatus } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const { t } = useTranslation();
  
  const [value, setValue] = useState((settings?.similarityThreshold ?? 70).toString());
  const [autoDraft, setAutoDraft] = useState(settings?.autoDraftHighRisk ?? false);
  const [emailNotifications, setEmailNotifications] = useState(settings?.emailNotifications ?? true);
  const [notificationEmail, setNotificationEmail] = useState(settings?.notificationEmail ?? "");
  const [notificationLanguage, setNotificationLanguage] = useState(settings?.notificationLanguage ?? "en");

  const [vendorsList, setVendorsList] = useState<string[]>([]);
  const [typesList, setTypesList] = useState<string[]>([]);
  const [vendorInput, setVendorInput] = useState("");
  const [typeInput, setTypeInput] = useState("");

  useEffect(() => {
    if (settings) {
      setValue((settings.similarityThreshold ?? 70).toString());
      setAutoDraft(settings.autoDraftHighRisk ?? false);
      setEmailNotifications(settings.emailNotifications ?? true);
      setNotificationEmail(settings.notificationEmail ?? "");
      setNotificationLanguage(settings.notificationLanguage ?? "en");
      setVendorsList(settings.excludeVendors ? settings.excludeVendors.split(',').map(s => s.trim()).filter(Boolean) : []);
      setTypesList(settings.excludeTypes ? settings.excludeTypes.split(',').map(s => s.trim()).filter(Boolean) : []);
    }
  }, [settings]);

  const handleVendorKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      const val = vendorInput.trim().replace(/,$/, '');
      if (val && !vendorsList.includes(val)) {
        const newList = [...vendorsList, val];
        setVendorsList(newList);
      }
      setVendorInput("");
    } else if (e.key === 'Backspace' && !vendorInput && vendorsList.length > 0) {
      const newList = vendorsList.slice(0, -1);
      setVendorsList(newList);
    }
  };

  const handleVendorBlur = () => {
    const val = vendorInput.trim().replace(/,$/, '');
    if (val && !vendorsList.includes(val)) {
      const newList = [...vendorsList, val];
      setVendorsList(newList);
    }
    setVendorInput("");
  };

  const handleTypeKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      const val = typeInput.trim().replace(/,$/, '');
      if (val && !typesList.includes(val)) {
        const newList = [...typesList, val];
        setTypesList(newList);
      }
      setTypeInput("");
    } else if (e.key === 'Backspace' && !typeInput && typesList.length > 0) {
      const newList = typesList.slice(0, -1);
      setTypesList(newList);
    }
  };

  const handleTypeBlur = () => {
    const val = typeInput.trim().replace(/,$/, '');
    if (val && !typesList.includes(val)) {
      const newList = [...typesList, val];
      setTypesList(newList);
    }
    setTypeInput("");
  };

  const isSubmitting = navigation.state === "submitting" || navigation.state === "loading";
  const thresholdNumber = Number(value);
  const monitoringMode =
    thresholdNumber < 60 ? "broad" : thresholdNumber <= 75 ? "balanced" : "strict";

  return (
    <s-page size="large" className="page-shell" suppressHydrationWarning>
      <s-heading slot="title" size="large" suppressHydrationWarning>{t('settings.title')}</s-heading>

      <div className="admin-stack">
        {actionData && "error" in actionData && actionData.error === "invalid_notification_email" ? (
          <s-banner tone="critical" heading={t("settingsAdmin.notifications.invalidEmail")} />
        ) : null}
        <Form method="post">
          <input type="hidden" name="autoDraftHighRisk" value={autoDraft ? "true" : "false"} />
          <input type="hidden" name="emailNotifications" value={emailNotifications ? "true" : "false"} />
          <input type="hidden" name="notificationEmail" value={notificationEmail} />
          <input type="hidden" name="notificationLanguage" value={notificationLanguage} />
          <input type="hidden" name="excludeVendors" value={vendorsList.join(', ')} />
          <input type="hidden" name="excludeTypes" value={typesList.join(', ')} />

          <section className="admin-card monitoring-settings-overview">
            <div className="admin-card__header">
              <div>
                <p className="admin-eyebrow">{t("settingsAdmin.automationStatusEyebrow")}</p>
                <h2 className="admin-card__title">{t("settingsAdmin.automationStatusTitle")}</h2>
                <p className="admin-card__description">{t("settingsAdmin.automationStatusDescription")}</p>
              </div>
              <s-badge tone="success">{t("settingsAdmin.status.running")}</s-badge>
            </div>
            <div className="settings-status-grid">
              <div className="settings-status-item">
                <span>{t("settingsAdmin.status.dailySafetyGateUpdates")}</span>
                <strong>{t("settingsAdmin.status.on")}</strong>
              </div>
              <div className="settings-status-item">
                <span>{t("settingsAdmin.status.shopifyProductUpdates")}</span>
                <strong>{t("settingsAdmin.status.on")}</strong>
              </div>
              <div className="settings-status-item">
                <span>{t("settingsAdmin.status.auditTrail")}</span>
                <strong>{t("settingsAdmin.status.on")}</strong>
              </div>
              <div className="settings-status-item">
                <span>{t("settingsAdmin.status.autoQuarantine")}</span>
                <strong>{autoDraft ? t("settingsAdmin.status.on") : t("settingsAdmin.status.off")}</strong>
              </div>
            </div>
          </section>

          <section className="admin-section-grid admin-section-grid--wide">
            {/* COLUMN 1: Settings Form */}
            <div className="admin-stack">
              {/* Threshold Settings */}
              <div className="admin-card">
                <div className="admin-card__header">
                  <div>
                    <p className="admin-eyebrow">{t("settingsAdmin.monitoringModeEyebrow")}</p>
                    <h2 className="admin-card__title">{t('settings.threshold.title')}</h2>
                    <p className="admin-card__description">{t('settings.threshold.description')}</p>
                  </div>
                  <s-badge tone="info">{t(`settingsAdmin.mode.${monitoringMode}`)}</s-badge>
                </div>

                <div className="monitoring-mode-grid">
                  <button
                    type="button"
                    className={`monitoring-mode-option ${monitoringMode === "broad" ? "monitoring-mode-option--active" : ""}`}
                    onClick={() => setValue("50")}
                  >
                    <strong>{t("settingsAdmin.guidanceItems.broadTitle")}</strong>
                    <span>{t("settingsAdmin.guidanceItems.broadDescription")}</span>
                  </button>
                  <button
                    type="button"
                    className={`monitoring-mode-option ${monitoringMode === "balanced" ? "monitoring-mode-option--active" : ""}`}
                    onClick={() => setValue("70")}
                  >
                    <strong>{t("settingsAdmin.guidanceItems.balancedTitle")}</strong>
                    <span>{t("settingsAdmin.guidanceItems.balancedDescription")}</span>
                  </button>
                  <button
                    type="button"
                    className={`monitoring-mode-option ${monitoringMode === "strict" ? "monitoring-mode-option--active" : ""}`}
                    onClick={() => setValue("85")}
                  >
                    <strong>{t("settingsAdmin.guidanceItems.strictTitle")}</strong>
                    <span>{t("settingsAdmin.guidanceItems.strictDescription")}</span>
                  </button>
                </div>

                <details className="advanced-settings-disclosure">
                  <summary>{t("settingsAdmin.advancedMatchingSettings")}</summary>
                  <div className="admin-note">
                    <strong>{t('settings.threshold.howItWorks')}</strong>
                    <span>{t("settingsAdmin.strictnessHint")}</span>
                  </div>
                  <div className="admin-form-block">
                    <s-number-field
                      label={t('settings.threshold.label')}
                      labelAccessibilityVisibility="visible"
                      name="similarityThreshold"
                      min="0"
                      max="100"
                      value={value}
                      onChange={(e: any) => setValue(e.currentTarget.value)}
                    />
                  </div>
                </details>
              </div>

              {/* Automation & Notifications settings */}
              <div className="admin-card">
                <div className="admin-card__header">
                  <div>
                    <p className="admin-eyebrow">{t("settingsAdmin.automation.eyebrow")}</p>
                    <h2 className="admin-card__title">{t("settingsAdmin.automation.title")}</h2>
                    <p className="admin-card__description">{t("settingsAdmin.automation.description")}</p>
                  </div>
                </div>

                <div className="admin-form-block" style={{ gap: '20px', display: 'flex', flexDirection: 'column' }}>
                  <div className="admin-checkbox-group">
                    <label style={{ display: 'flex', alignItems: 'flex-start', cursor: 'pointer', gap: '10px' }}>
                      <input
                        type="checkbox"
                        checked={emailNotifications}
                        onChange={(e) => setEmailNotifications(e.target.checked)}
                        style={{ marginTop: '3px', transform: 'scale(1.15)' }}
                      />
                      <div>
                        <s-text fontWeight="bold">{t("settingsAdmin.notifications.enabledTitle")}</s-text>
                        <br />
                        <s-text tone="subdued" size="small">{t("settingsAdmin.notifications.enabledDescription")}</s-text>
                      </div>
                    </label>
                  </div>
                  <s-text-field
                    label={t("settingsAdmin.notifications.emailLabel")}
                    type="email"
                    value={notificationEmail}
                    disabled={!emailNotifications || undefined}
                    onChange={(event: any) => setNotificationEmail(event.currentTarget.value)}
                    helpText={t("settingsAdmin.notifications.emailHelp")}
                  />
                  <s-select
                    label={t("settingsAdmin.notifications.languageLabel")}
                    value={notificationLanguage}
                    disabled={!emailNotifications || undefined}
                    onChange={(event: any) => setNotificationLanguage(event.currentTarget.value)}
                  >
                    {EU_LANGUAGES.map((language) => (
                      <s-option key={language.code} value={language.code}>{language.label}</s-option>
                    ))}
                  </s-select>
                  <div className="admin-checkbox-group">
                    <label style={{ display: 'flex', alignItems: 'flex-start', cursor: 'pointer', gap: '10px' }}>
                      <input
                        type="checkbox"
                        checked={autoDraft}
                        onChange={(e) => setAutoDraft(e.target.checked)}
                        style={{ marginTop: '3px', transform: 'scale(1.15)' }}
                      />
                      <div>
                        <s-text fontWeight="bold">{t("settingsAdmin.automation.autoDraftTitle")}</s-text>
                        <br />
                        <s-text tone="subdued" size="small">{t("settingsAdmin.automation.autoDraftDescription")}</s-text>
                      </div>
                    </label>
                  </div>
                </div>
              </div>

              {/* Exclusion rules settings */}
              <div className="admin-card">
                <div className="admin-card__header">
                  <div>
                    <p className="admin-eyebrow">{t("settingsAdmin.exclusions.eyebrow")}</p>
                    <h2 className="admin-card__title">{t("settingsAdmin.exclusions.title")}</h2>
                    <p className="admin-card__description">{t("settingsAdmin.exclusions.description")}</p>
                  </div>
                </div>

                <div className="admin-form-block" style={{ gap: '20px', display: 'flex', flexDirection: 'column' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <label htmlFor="excluded-vendors"><s-text fontWeight="bold">{t("settingsAdmin.exclusions.vendorsTitle")}</s-text></label>
                    <s-text tone="subdued" size="small">{t("settingsAdmin.exclusions.vendorsDescription")}</s-text>
                    <div className="chip-container">
                      {vendorsList.map((vendor, idx) => (
                        <s-chip key={vendor} onDismiss={() => {
                          const newList = vendorsList.filter((_, i) => i !== idx);
                          setVendorsList(newList);
                        }}>
                          {vendor}
                        </s-chip>
                      ))}
                      <input
                        type="text"
                        id="excluded-vendors"
                        aria-label={t("settingsAdmin.exclusions.vendorsTitle")}
                        placeholder={vendorsList.length === 0 ? t("settingsAdmin.exclusions.vendorsPlaceholder") : ""}
                        value={vendorInput}
                        onChange={(e) => setVendorInput(e.target.value)}
                        onKeyDown={handleVendorKeyDown}
                        onBlur={handleVendorBlur}
                        className="chip-input"
                      />
                    </div>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <label htmlFor="excluded-product-types"><s-text fontWeight="bold">{t("settingsAdmin.exclusions.typesTitle")}</s-text></label>
                    <s-text tone="subdued" size="small">{t("settingsAdmin.exclusions.typesDescription")}</s-text>
                    <div className="chip-container">
                      {typesList.map((type, idx) => (
                        <s-chip key={type} onDismiss={() => {
                          const newList = typesList.filter((_, i) => i !== idx);
                          setTypesList(newList);
                        }}>
                          {type}
                        </s-chip>
                      ))}
                      <input
                        type="text"
                        id="excluded-product-types"
                        aria-label={t("settingsAdmin.exclusions.typesTitle")}
                        placeholder={typesList.length === 0 ? t("settingsAdmin.exclusions.typesPlaceholder") : ""}
                        value={typeInput}
                        onChange={(e) => setTypeInput(e.target.value)}
                        onKeyDown={handleTypeKeyDown}
                        onBlur={handleTypeBlur}
                        className="chip-input"
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Save actions */}
              <div className="admin-actions" style={{ padding: '16px 0' }}>
                <s-button type="submit" variant="primary" loading={isSubmitting || undefined}>
                  {t("settingsAdmin.saveAll")}
                </s-button>
                <s-button type="button" variant="secondary" onClick={() => {
                  setValue(envDefault.toString());
                  setAutoDraft(false);
                  setEmailNotifications(true);
                  setNotificationLanguage("en");
                  setVendorInput("");
                  setTypeInput("");
                  setVendorsList([]);
                  setTypesList([]);
                }}>
                  {t('settings.threshold.resetToDefault')}
                </s-button>
              </div>
            </div>

            {/* COLUMN 2: Guidance info */}
            <div className="admin-stack">
              <div className="admin-card settings-value-card">
                <div className="admin-card__header">
                  <div>
                    <p className="admin-eyebrow">{t("settingsAdmin.valueEyebrow")}</p>
                    <h2 className="admin-card__title">{t("settingsAdmin.valueTitle")}</h2>
                    <p className="admin-card__description">{t("settingsAdmin.valueDescription")}</p>
                  </div>
                </div>

                <div className="admin-guidance-list">
                  <div className="admin-guidance-item">
                    <strong>{t("settingsAdmin.valueItems.dailyTitle")}</strong>
                    <p>{t("settingsAdmin.valueItems.dailyDescription")}</p>
                  </div>
                  <div className="admin-guidance-item">
                    <strong>{t("settingsAdmin.valueItems.auditTitle")}</strong>
                    <p>{t("settingsAdmin.valueItems.auditDescription")}</p>
                  </div>
                  <div className="admin-guidance-item">
                    <strong>{t("settingsAdmin.valueItems.workflowTitle")}</strong>
                    <p>{t("settingsAdmin.valueItems.workflowDescription")}</p>
                  </div>
                </div>
              </div>

              <details className="advanced-settings-disclosure settings-subscription-disclosure">
                <summary>{t("settingsAdmin.included.title")}</summary>
                <div className="admin-note">
                  <strong>{t("settingsAdmin.included.monitoringTitle")}</strong>
                  <span>{t("settingsAdmin.included.monitoringDescription")}</span>
                </div>
                <div className="admin-note">
                  <strong>{t("settingsAdmin.included.evidenceTitle")}</strong>
                  <span>{t("settingsAdmin.included.evidenceDescription")}</span>
                </div>
                <div className="admin-note">
                  <strong>{t("settingsAdmin.included.teamTitle")}</strong>
                  <span>{t("settingsAdmin.included.teamDescription")}</span>
                </div>
              </details>

              <div className="admin-card">
                <div className="admin-card__header">
                  <div>
                    <p className="admin-eyebrow">{t("billing.planEyebrow")}</p>
                    <h2 className="admin-card__title">{t("billing.planTitle")}</h2>
                    <p className="admin-card__description">
                      {billingStatus.hasActivePayment
                        ? t("billing.planActiveDescription")
                        : billingStatus.freeScanUsed
                          ? t("billing.planFreeUsedDescription")
                          : t("billing.planFreeAvailableDescription")}
                    </p>
                  </div>
                </div>
                <div className="admin-form-block">
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "12px" }}>
                    <div>
                      <span style={{ marginRight: "8px", fontWeight: 600 }}>{t("billing.statusLabel")}:</span>
                      <s-badge tone={billingStatus.hasActivePayment ? "success" : billingStatus.freeScanUsed ? "warning" : "info"}>
                        {billingStatus.hasActivePayment
                          ? t("billing.statusActivePro")
                          : billingStatus.freeScanUsed
                            ? t("billing.statusFreeUsed")
                            : t("billing.statusFreeAvailable")}
                      </s-badge>
                    </div>
                    <s-button
                      variant={billingStatus.hasActivePayment ? "secondary" : "primary"}
                      onClick={() => window.open(billingStatus.pricingPlansUrl, "_top")}
                      suppressHydrationWarning
                    >
                      {billingStatus.hasActivePayment ? t("billing.managePlanButton") : t("billing.upgradePlanButton")}
                    </s-button>
                  </div>
                </div>
              </div>

              <div className="admin-card">
                <div className="admin-card__header">
                  <div>
                    <h2 className="admin-card__title">{t('common.language')}</h2>
                  </div>
                </div>
                <div className="admin-form-block">
                  <LanguageSwitcher />
                </div>
              </div>

            </div>
          </section>
        </Form>
      </div>
    </s-page>
  );
}
