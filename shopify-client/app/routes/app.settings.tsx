import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { data as json, redirect } from "react-router";
import { useLoaderData, useNavigation, Form, useRouteError, isRouteErrorResponse } from "react-router";
import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { authenticate } from "../shopify.server";
import db from "../merchant-db.server";
import { LanguageSwitcher } from "../components";
import { requireActiveBilling } from "../services/billing.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { billing, session } = await authenticate.admin(request);
  const billingRedirect = await requireActiveBilling(billing, session.shop);
  if (billingRedirect) return billingRedirect as never;
  const settings = await db.safetySetting.findUnique({
    where: { shop: session.shop },
  });
  
  const envDefault = Number(process.env.SAFETY_GATE_SIMILARITY_THRESHOLD || "0");
  const fallbackDefault = Number.isFinite(envDefault) ? envDefault : 70;

  return json({
    settings: settings || {
      similarityThreshold: fallbackDefault,
      autoDraftHighRisk: false,
      emailNotifications: false,
      slackWebhookUrl: null,
      excludeVendors: null,
      excludeTypes: null,
    },
    envDefault: fallbackDefault,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { billing, session } = await authenticate.admin(request);
  const billingRedirect = await requireActiveBilling(billing, session.shop);
  if (billingRedirect) return billingRedirect as never;
  const formData = await request.formData();
  
  const threshold = Number(formData.get("similarityThreshold"));
  const similarityThreshold = Number.isFinite(threshold)
    ? Math.min(Math.max(Math.round(threshold), 0), 100)
    : 70;

  const autoDraftHighRisk = formData.get("autoDraftHighRisk") === "true";
  const slackWebhookUrl = (formData.get("slackWebhookUrl") as string) || null;
  const excludeVendors = (formData.get("excludeVendors") as string) || null;
  const excludeTypes = (formData.get("excludeTypes") as string) || null;

  await db.safetySetting.upsert({
    where: { shop: session.shop },
    update: {
      similarityThreshold,
      autoDraftHighRisk,
      emailNotifications: false,
      slackWebhookUrl,
      excludeVendors,
      excludeTypes,
    },
    create: {
      shop: session.shop,
      similarityThreshold,
      autoDraftHighRisk,
      emailNotifications: false,
      slackWebhookUrl,
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
  const { settings, envDefault } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const { t } = useTranslation();
  
  const [value, setValue] = useState((settings?.similarityThreshold ?? 70).toString());
  const [autoDraft, setAutoDraft] = useState(settings?.autoDraftHighRisk ?? false);
  const [slackUrl, setSlackUrl] = useState(settings?.slackWebhookUrl ?? "");

  const [vendorsList, setVendorsList] = useState<string[]>([]);
  const [typesList, setTypesList] = useState<string[]>([]);
  const [vendorInput, setVendorInput] = useState("");
  const [typeInput, setTypeInput] = useState("");

  useEffect(() => {
    if (settings) {
      setValue((settings.similarityThreshold ?? 70).toString());
      setAutoDraft(settings.autoDraftHighRisk ?? false);
      setSlackUrl(settings.slackWebhookUrl ?? "");
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
        <Form method="post">
          <input type="hidden" name="autoDraftHighRisk" value={autoDraft ? "true" : "false"} />
          <input type="hidden" name="emailNotifications" value="false" />
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

          <section className="subscription-included-panel">
            <div>
              <p className="admin-eyebrow">{t("settingsAdmin.included.eyebrow")}</p>
              <h2 className="admin-card__title">{t("settingsAdmin.included.title")}</h2>
              <p className="admin-card__description">{t("settingsAdmin.included.description")}</p>
            </div>
            <div className="subscription-included-grid">
              <div className="subscription-included-item">
                <strong>{t("settingsAdmin.included.monitoringTitle")}</strong>
                <span>{t("settingsAdmin.included.monitoringDescription")}</span>
              </div>
              <div className="subscription-included-item">
                <strong>{t("settingsAdmin.included.evidenceTitle")}</strong>
                <span>{t("settingsAdmin.included.evidenceDescription")}</span>
              </div>
              <div className="subscription-included-item">
                <strong>{t("settingsAdmin.included.teamTitle")}</strong>
                <span>{t("settingsAdmin.included.teamDescription")}</span>
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

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <s-text fontWeight="bold">{t("settingsAdmin.automation.slackTitle")}</s-text>
                    <s-text tone="subdued" size="small">{t("settingsAdmin.automation.slackDescription")}</s-text>
                    <input
                      type="text"
                      name="slackWebhookUrl"
                      placeholder="https://hooks.slack.com/services/..."
                      value={slackUrl}
                      onChange={(e) => setSlackUrl(e.target.value)}
                      style={{
                        width: '100%',
                        padding: '10px 12px',
                        borderRadius: '6px',
                        border: '1px solid var(--border)',
                        fontSize: '14px',
                        marginTop: '4px'
                      }}
                    />
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
                    <s-text fontWeight="bold">{t("settingsAdmin.exclusions.vendorsTitle")}</s-text>
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
                    <s-text fontWeight="bold">{t("settingsAdmin.exclusions.typesTitle")}</s-text>
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
                  setSlackUrl("");
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
              <div className="admin-card">
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
