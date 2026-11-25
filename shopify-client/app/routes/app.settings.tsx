import { AdminCard } from "../components/AdminCard";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { data as json, redirect } from "react-router";
import {
  Await,
  useActionData,
  useLoaderData,
  useFetcher,
  useNavigation,
  useBlocker,
  useLocation,
  useRevalidator,
  Form,
  useRouteError,
  isRouteErrorResponse,
} from "react-router";
import { Suspense, useState, useEffect, useRef } from "react";
import { SaveBar, useAppBridge } from "@shopify/app-bridge-react";
import { useTranslation } from "react-i18next";
import { authenticate } from "../shopify.server";
import db, { safetySettingFromSnapshot } from "../merchant-db.server";
import { LanguageSwitcher } from "../components";
import { MonitoringStatus } from "../components/MonitoringStatus";
import { getBillingStatus, invalidateBillingStatusCache } from "../services/billing.server";
import { cancelSubscription } from "../services/cancel-subscription.server";
import { SHOPIFY_BILLING_MODE } from "../shopify.server";
import { EU_LANGUAGES } from "../locales/languages";
import { interfaceLanguageFromCookie, normalizeInterfaceLanguage, selectInterfaceLanguage } from "../services/interface-language";
import { notificationLanguageSelection } from "../services/notification-language";
import { firestore } from "../firestore.server";
import { getRecentMonitoringRuns } from "../services/monitoring-runs.server";
import { toIsoString } from "../services/monitoring-runs";
import { monitoringState } from "../services/monitoring-state";
import { plannedMonitoringAt } from "../services/monitoring-schedule";
import { displayShopifyPlan } from "../services/partner-entitlement";

import { getShopifyNotificationEmail, notificationEmailPattern } from "../services/shopify-notification-email.server";

export const loader = async ({ request, url }: LoaderFunctionArgs) => {
  const context = await authenticate.admin(request);
  const shopifyLocale =
    interfaceLanguageFromCookie(request.headers.get("Cookie")) ||
    normalizeInterfaceLanguage(url.searchParams.get("locale"));
  return {
    data: loadSettingsPage(context, url),
    shopifyLocale,
  };
};

async function loadSettingsPage(
  { admin, billing, session }: Awaited<ReturnType<typeof authenticate.admin>>,
  url: URL,
) {
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
  const initialAuditAt = toIsoString(monitor?.initialScanCompletedAt);
  const automaticMonitoring = monitoringState(billingStatus, latestRunStatus, observedAt, lastMonitoringAt, initialAuditAt);
  const nextCheck = plannedMonitoringAt(Boolean(toIsoString(monitor?.monitoringBaselineAt)), automaticMonitoring, observedAt);

  let settings = monitorSnapshot
    ? safetySettingFromSnapshot(session.shop, monitorSnapshot)
    : await db.safetySetting.findUnique({ where: { shop: session.shop } });

  const envDefault = Number(
    process.env.SAFETY_GATE_SIMILARITY_THRESHOLD || "0",
  );
  const fallbackDefault = Number.isFinite(envDefault) ? envDefault : 70;

  const shopifyContactEmail = !settings?.notificationEmail?.trim() && settings?.notificationEmailSource !== "custom"
    ? await getShopifyNotificationEmail(admin)
    : null;

  if (
    !settings ||
    settings.emailNotifications === undefined ||
    settings.immediateAlertEmails === undefined ||
    settings.weeklySummaryEmails === undefined ||
    shopifyContactEmail
  ) {
    const initialized = await db.safetySetting.upsert({
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
        ...(shopifyContactEmail
          ? {
              notificationEmail: shopifyContactEmail,
              notificationEmailSource: "shopify" as const,
            }
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
        excludeVendors: null,
        excludeTypes: null,
      },
    });
    // The upsert result contains only values written by that operation.
    settings = await db.safetySetting.findUnique({ where: { shop: session.shop } }) ?? initialized;
  }

  return {
    saved: url.searchParams.get("saved") === "1",
    settings: settings || {
      similarityThreshold: fallbackDefault,
      autoDraftHighRisk: false,
      emailNotifications: true,
      immediateAlertEmails: true,
      weeklySummaryEmails: true,
      notificationEmail: shopifyContactEmail,
      notificationEmailSource: "shopify",
      excludeVendors: null,
      excludeTypes: null,
    },
    billingStatus,
    supportsCancellation: SHOPIFY_BILLING_MODE === "app-pricing",
    lastMonitoringAt,
    automaticMonitoring,
    initialAuditCompleted: Boolean(initialAuditAt),
    nextCheck,
    emailDelivery,
    lastVerifiedPlan: displayShopifyPlan(monitor?.planHandle),
  } as const;
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, sessionToken, billing, admin } = await authenticate.admin(request);
  const formData = await request.formData();
  if (formData.get("intent") === "stop-renewal") {
    const status = await getBillingStatus(billing, session.shop, admin);
    if (status.cancelAtEndOfCycle || (status.billingVerified && !status.hasActivePayment)) {
      return json({ cancellation: "accepted" as const });
    }
    if (!sessionToken?.sub || !status.billingVerified || !status.hasActivePayment || !status.validUntil) {
      return json({ cancellation: "failed" as const }, { status: 409 });
    }
    try {
      const cancellation = await cancelSubscription(request, session.shop, sessionToken.sub);
      if (cancellation === "accepted") invalidateBillingStatusCache(session.shop);
      return json({ cancellation }, { status: cancellation === "accepted" ? 200 : cancellation === "ownerRequired" ? 403 : 502 });
    } catch {
      return json({ cancellation: "failed" as const }, { status: 502 });
    }
  }

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
  const requestedLanguage = normalizeInterfaceLanguage(String(formData.get("notificationLanguage") || ""));
  const appLanguage = selectInterfaceLanguage(
    String(formData.get("appLanguage") || ""),
    new URL(request.url).searchParams.get("locale") || undefined,
  );
  const notificationLanguage = requestedLanguage ?? appLanguage;
  const notificationLanguageSource = requestedLanguage ? "custom" as const : "app" as const;
  if (emailNotifications && !notificationEmailPattern.test(notificationEmail)) {
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
      notificationLanguageSource,
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
      notificationLanguageSource,
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
    <s-page suppressHydrationWarning heading={t("settings.title")}>

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
  const { data, shopifyLocale } = useLoaderData<typeof loader>();
  const { t } = useTranslation();
  return (
    <Suspense fallback={
      <s-page inlineSize="base" className="page-shell" heading={t("settings.title", { lng: shopifyLocale })} suppressHydrationWarning>
        <div aria-hidden="true" className="overview-loading" style={{ marginTop: "var(--s-space-300)" }}>
          {[0, 1, 2].map(index => (
            <section key={index} className="overview-monitor overview-monitor--loading">
              <div className="overview-loading__lines">
                <span />
                <span />
              </div>
            </section>
          ))}
        </div>
      </s-page>
    }>
      <Await resolve={data}>
        {(resolved: Awaited<ReturnType<typeof loadSettingsPage>>) => <SettingsContent data={resolved} />}
      </Await>
    </Suspense>
  );
}

export function SettingsContent({ data }: { data: Awaited<ReturnType<typeof loadSettingsPage>> }) {
  const { settings, billingStatus, saved, lastMonitoringAt, automaticMonitoring, initialAuditCompleted, nextCheck, emailDelivery, lastVerifiedPlan, supportsCancellation } = data;
  const actionData = useActionData<typeof action>();
  const cancellation = useFetcher<typeof action>();
  const previewFetcher = useFetcher<{ total: number; excludedCount: number; sample: Array<{ id: string; title: string }> }>();
  const navigation = useNavigation();
  const location = useLocation();
  const shopify = useAppBridge();
  const formRef = useRef<HTMLFormElement>(null);
  const savingRef = useRef(false);
  const shownSavedToastKey = useRef<string | null>(null);
  const revalidator = useRevalidator();
  const { t, i18n } = useTranslation();
  const [exclusionsOpen, setExclusionsOpen] = useState(false);
  const initial = {
    threshold: String(settings.similarityThreshold ?? 70),
    priority: settings.autoDraftHighRisk ?? false,
    immediate:
      settings.immediateAlertEmails ?? settings.emailNotifications ?? true,
    weekly: settings.weeklySummaryEmails ?? settings.emailNotifications ?? true,
    email: settings.notificationEmail || "",
    language: notificationLanguageSelection(settings),
    vendors: settings.excludeVendors || "",
    types: settings.excludeTypes || "",
  };
  const appLanguage = selectInterfaceLanguage(i18n.resolvedLanguage || i18n.language);
  const savedValues = JSON.stringify(initial);
  const [values, setValues] = useState(initial);
  useEffect(() => {
    // A rejected POST also changes the location key. Keep its draft so the
    // merchant can correct the field instead of losing their other edits.
    if (actionData && "error" in actionData) return;
    setValues(JSON.parse(savedValues) as typeof initial);
  }, [savedValues, location.key, actionData]);
  const dirty = JSON.stringify(values) !== savedValues;
  const busy = navigation.state !== "idle";
  const blocker = useBlocker(({ currentLocation, nextLocation }) =>
    dirty && !savingRef.current && (
      currentLocation.pathname !== nextLocation.pathname ||
      currentLocation.search !== nextLocation.search ||
      currentLocation.hash !== nextLocation.hash
    ),
  );
  useEffect(() => {
    if (!busy) savingRef.current = false;
  }, [busy]);
  useEffect(() => {
    if (blocker.state !== "blocked") return;
    let current = true;
    // React Router navigation stays in the iframe, so ask Shopify's native
    // save bar before continuing. Shopify handles its own Admin navigation.
    void shopify.saveBar.leaveConfirmation().then(() => {
      if (current) blocker.proceed();
    }).catch(() => {
      if (current) blocker.reset();
    });
    return () => { current = false; };
  }, [blocker, shopify]);
  useEffect(() => {
    if (!dirty) return;
    const preventUnsavedReload = (event: BeforeUnloadEvent) => {
      if (savingRef.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", preventUnsavedReload);
    return () => window.removeEventListener("beforeunload", preventUnsavedReload);
  }, [dirty]);
  useEffect(() => {
    if (!saved || dirty) return;
    if (shownSavedToastKey.current === location.key) return;
    shownSavedToastKey.current = location.key;
    shopify.toast?.show?.(t("workspace.saved"));
  }, [saved, dirty, location.key, shopify, t]);
  const loadPreview = previewFetcher.load;
  useEffect(() => {
    if (!exclusionsOpen) return;
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams({
        vendors: values.vendors,
        types: values.types,
      });
      loadPreview(`/api/exclusion-preview?${params}`);
    }, 200);
    return () => window.clearTimeout(timer);
  }, [exclusionsOpen, values.vendors, values.types, loadPreview]);
  const change = <K extends keyof typeof values>(
    key: K,
    value: (typeof values)[K],
  ) => setValues((current) => ({ ...current, [key]: value }));
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
  const planEnd = billingStatus.validUntil && new Intl.DateTimeFormat(i18n.language, {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(billingStatus.validUntil));
  const cancelResult = cancellation.data && "cancellation" in cancellation.data ? cancellation.data.cancellation : null;
  const cancellationScheduled = planVerified && billingStatus.hasActivePayment && billingStatus.cancelAtEndOfCycle && planEnd;

  return (
    <s-page inlineSize="base" className="page-shell" heading={t("settings.title")}>
      <SaveBar id="settings-save-bar" open={dirty} discardConfirmation>
        <button
          type="button"
          {...{ variant: "primary", loading: busy ? "" : undefined }}
          disabled={busy}
          onClick={() => formRef.current?.requestSubmit()}
        >
          {t("workspace.saveChanges")}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => setValues(JSON.parse(savedValues) as typeof initial)}
        >
          {t("settingsUx.discard")}
        </button>
      </SaveBar>
      <div className="admin-stack">
        <AdminCard className="admin-card">
          <div className="settings-overview">
            <section id="subscription" className="settings-overview__panel">
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
              {cancellationScheduled ? (
                <p className="admin-helper" role="status">{t("settingsOverview.endsOn", { date: planEnd })}</p>
              ) : supportsCancellation && planVerified && billingStatus.hasActivePayment && planEnd && (
                <>
                  {cancelResult === "accepted" ? (
                    <p className="admin-helper" role="status">{t("settingsOverview.cancellationPending")}</p>
                  ) : (
                    <>
                      <div>
                        <s-button
                          variant="tertiary"
                          tone="critical"
                          commandFor="stop-renewal-modal"
                          command="--show"
                        >
                          {t("settingsOverview.stopRenewal")}
                        </s-button>
                      </div>
                      {cancelResult && <p role="alert" className="admin-helper">{t(`settingsOverview.cancelError.${cancelResult}`)}</p>}
                      <s-modal id="stop-renewal-modal" heading={t("settingsOverview.stopRenewal")}>
                        <s-text>{t("settingsOverview.stopRenewalHelp", { date: planEnd })}</s-text>
                        <s-button
                          slot="primary-action"
                          variant="primary"
                          tone="critical"
                          loading={cancellation.state !== "idle" || undefined}
                          disabled={cancellation.state !== "idle" || undefined}
                          commandFor="stop-renewal-modal"
                          command="--hide"
                          onClick={() => cancellation.submit({ intent: "stop-renewal" }, { method: "post" })}
                        >
                          {t("settingsOverview.stopRenewal")}
                        </s-button>
                        <s-button
                          slot="secondary-actions"
                          variant="secondary"
                          commandFor="stop-renewal-modal"
                          command="--hide"
                        >
                          {t("common.cancel")}
                        </s-button>
                      </s-modal>
                    </>
                  )}
                </>
              )}
            </section>
            <MonitoringStatus
              state={automaticMonitoring}
              lastSuccess={lastMonitoringAt}
              initialAuditCompleted={initialAuditCompleted}
              nextCheck={nextCheck}
            />
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
              {sendsEmail && initial.email.trim() && (
                <p className="admin-helper">{t("settingsOverview.recipient", { email: initial.email })}</p>
              )}
              {sendsEmail && !initial.email.trim() && (
                <s-banner tone="warning" heading={t("settingsAdmin.notifications.noRecipientHeading")}>
                  <s-text>{t("settingsAdmin.notifications.noRecipientDescription")}</s-text>
                </s-banner>
              )}
              {sendsEmail && initial.email.trim() && emailDelivery !== "eligible" && (
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
        {actionData && "error" in actionData && (
          <s-banner
            tone="critical"
            heading={t("settingsAdmin.notifications.invalidEmail")}
          />
        )}
        <Form
          ref={formRef}
          method="post"
          className="admin-stack"
          onSubmit={() => { savingRef.current = true; }}
        >
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
          <input type="hidden" name="appLanguage" value={appLanguage} />
          <input type="hidden" name="excludeVendors" value={values.vendors} />
          <input type="hidden" name="excludeTypes" value={values.types} />
          <s-section heading={t("redesign.notifications")}>
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
                  <s-option value="app">
                    {t("workspace.appLanguage")} ({EU_LANGUAGES.find(language => language.code === appLanguage)?.label})
                  </s-option>
                  {EU_LANGUAGES.map((language) => (
                    <s-option key={language.code} value={language.code}>
                      {language.label}
                    </s-option>
                  ))}
                </s-select>
                {values.language !== "app" && appLanguage !== values.language && (
                  <p className="admin-helper" role="status">
                    {t("analysis.reviewLayout.languageDiffNote", {
                      appLang:
                        EU_LANGUAGES.find(
                          (l) => l.code === appLanguage,
                        )?.label || i18n.language,
                      emailLang:
                        EU_LANGUAGES.find((l) => l.code === values.language)
                          ?.label || values.language,
                    })}
                  </p>
                )}
              </div>
          </s-section>
          <s-section heading={t("workspace.appLanguage")}>
            <LanguageSwitcher />
          </s-section>
          <s-section heading={t("redesign.matching")}>
              <div className="admin-stack">
                <p className="admin-helper">{t("workspace.balancedHelp")}</p>
                <s-choice-list
                  label={t("settings.threshold.title")}
                  name="monitoringModeChoice"
                  onChange={(event: any) => {
                    const chosen = event.currentTarget.values?.[0];
                    const thresholds: Record<string, string> = {
                      broad: "50",
                      balanced: "70",
                      strict: "85",
                    };
                    if (chosen && thresholds[chosen]) {
                      change("threshold", thresholds[chosen]);
                    }
                  }}
                >
                  {(
                    [
                      ["broad", "50"],
                      ["balanced", "70"],
                      ["strict", "85"],
                    ] as const
                  ).map(([name]) => (
                    <s-choice
                      key={name}
                      value={name}
                      selected={mode === name}
                    >
                      {t(`settingsAdmin.mode.${name}`)}
                      {name === "balanced" ? ` (${t("workspace.recommended")})` : ""}
                      <span slot="details">{t(`workspace.${name}Help`)}</span>
                    </s-choice>
                  ))}
                </s-choice-list>
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
                <details
                  className="advanced-settings-disclosure"
                  onToggle={(event) => setExclusionsOpen(event.currentTarget.open)}
                >
                  <summary>{t("workspace.settingsAdvanced")}</summary>
                  <s-stack gap="base">
                    <s-number-field
                      label={t("settings.threshold.label")}
                      min="45"
                      max="95"
                      value={values.threshold}
                      onChange={(event: any) =>
                        change("threshold", event.currentTarget.value)
                      }
                    />
                    <p className="admin-helper">{t("workspace.excludeHelp")}</p>
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
                    {previewFetcher.state !== "idle" && !previewFetcher.data && (
                      <p role="status" className="admin-helper">{t("common.loading")}</p>
                    )}
                    {previewFetcher.data && (
                      <>
                        <p role="status" className="admin-helper">
                          {t("workspace.excluded", {
                            count: previewFetcher.data.excludedCount,
                            total: previewFetcher.data.total,
                          })}
                        </p>
                        {previewFetcher.data.sample.length > 0 && (
                          <ul>
                            {previewFetcher.data.sample.map((product) => (
                              <li key={product.id}>{product.title}</li>
                            ))}
                          </ul>
                        )}
                      </>
                    )}
                  </s-stack>
                </details>
              </div>
          </s-section>
          <s-section heading={t("settingsUx.supportTitle")}>
            <s-stack gap="small">
              <p className="admin-helper">{t("settingsUx.supportBody")}</p>
              <s-stack direction="inline" gap="base" wrap>
                <s-link href="mailto:info@zerorecall.online">info@zerorecall.online</s-link>
                <s-link href="https://ec.europa.eu/safety-gate-alerts/screen/home" target="_blank">
                  {t("viewExternalSource")}
                </s-link>
              </s-stack>
            </s-stack>
          </s-section>
        </Form>
      </div>
    </s-page>
  );
}
