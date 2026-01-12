import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData, useNavigation, Form } from "@remix-run/react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { getSimilarityThresholdForShop } from "../services/safety-gate-checker.server";
import { SafetyGatePortal, LanguageSwitcher } from "../components";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const current = await getSimilarityThresholdForShop(session.shop);
  const envDefault = Number(process.env.SAFETY_GATE_SIMILARITY_THRESHOLD || "0");

  return json({
    similarityThreshold: current,
    envDefault: Number.isFinite(envDefault) ? envDefault : 0,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const threshold = Number(formData.get("similarityThreshold"));
  const safeValue = Number.isFinite(threshold) && threshold >= 0 ? Math.round(threshold) : 0;

  await db.safetySetting.upsert({
    where: { shop: session.shop },
    update: { similarityThreshold: safeValue },
    create: { shop: session.shop, similarityThreshold: safeValue },
  });

  return redirect("/app/settings");
};

export default function Settings() {
  const { similarityThreshold, envDefault } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const { t } = useTranslation();
  const [value, setValue] = useState(similarityThreshold.toString());
  const isSubmitting = navigation.state === "submitting" || navigation.state === "loading";

  return (
    <s-page>
      {/* Page Title */}
      <s-heading slot="title" size="large">{t('settings.title')}</s-heading>

      {/* Main content */}
      <s-section>
        <s-text tone="subdued">{t('settings.subtitle')}</s-text>
      </s-section>

      <s-section>
        <s-box padding="base" border="base" borderRadius="large" background="bg-surface">
          <s-stack gap="base">
            <s-heading size="small">{t('settings.threshold.title')}</s-heading>

            <s-banner tone="info" heading={t('settings.threshold.howItWorks')}>
              <s-text>{t('settings.threshold.description')}</s-text>
            </s-banner>

            <Form method="post">
              <s-stack gap="base">
                <s-text>
                  {t('settings.threshold.currentDefault')}: <strong>{envDefault}%</strong>
                </s-text>

                <s-number-field
                  label={t('settings.threshold.label')}
                  name="similarityThreshold"
                  min="0"
                  max="100"
                  value={value}
                  onChange={(e: any) => setValue(e.currentTarget.value)}
                />

                <s-stack direction="inline" gap="small">
                  <s-button type="submit" variant="primary" loading={isSubmitting || undefined}>
                    {t('settings.threshold.save')}
                  </s-button>
                  <s-button type="button" variant="tertiary" onClick={() => setValue(envDefault.toString())}>
                    {t('settings.threshold.resetToDefault')}
                  </s-button>
                </s-stack>
              </s-stack>
            </Form>
          </s-stack>
        </s-box>
      </s-section>

      <s-section>
        <s-box padding="base" border="base" borderRadius="large" background="bg-surface">
          <s-stack gap="base">
            <s-heading size="small">{t('settings.monitoring.title')}</s-heading>

            <s-grid gap="base" gridTemplateColumns="1fr 1fr">
              <s-box padding="base" background="bg-surface-secondary" borderRadius="base">
                <s-stack gap="small">
                  <s-text fontWeight="bold">{t('settings.monitoring.automatic.title')}</s-text>
                  <s-text tone="subdued">{t('settings.monitoring.automatic.description')}</s-text>
                  <s-badge tone="success">{t('settings.monitoring.automatic.enabled')}</s-badge>
                </s-stack>
              </s-box>

              <s-box padding="base" background="bg-surface-secondary" borderRadius="base">
                <s-stack gap="small">
                  <s-text fontWeight="bold">{t('settings.monitoring.manual.title')}</s-text>
                  <s-text tone="subdued">{t('settings.monitoring.manual.description')}</s-text>
                  <s-button variant="secondary" size="small" href="/app/manual-check">
                    {t('settings.monitoring.manual.goToManualCheck')}
                  </s-button>
                </s-stack>
              </s-box>
            </s-grid>
          </s-stack>
        </s-box>
      </s-section>

      {/* Aside sidebar */}
      <div slot="aside">
        <s-section>
          <s-box padding="base" border="base" borderRadius="large" background="bg-surface">
            <s-stack gap="base">
              <s-heading size="small">{t('settings.navigation.title')}</s-heading>
              <s-stack gap="small">
                <s-button variant="secondary" href="/app">{t('settings.navigation.dashboard')}</s-button>
                <s-button variant="secondary" href="/app/alerts">{t('settings.navigation.viewAlerts')}</s-button>
                <s-button variant="secondary" href="/app/manual-check">{t('settings.navigation.manualCheck')}</s-button>
              </s-stack>
            </s-stack>
          </s-box>
        </s-section>

        <SafetyGatePortal />

        <s-section>
          <s-box padding="base" border="base" borderRadius="large" background="bg-surface">
            <s-stack gap="base">
              <s-heading size="small">{t('common.language')}</s-heading>
              <LanguageSwitcher />
            </s-stack>
          </s-box>
        </s-section>
      </div>
    </s-page>
  );
}
