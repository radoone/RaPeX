import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData, useNavigation, Form } from "@remix-run/react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { authenticate } from "../shopify.server";
import db from "../merchant-db.server";
import { getSimilarityThresholdForShop } from "../services/safety-gate-checker.server";
import { LanguageSwitcher, SummaryCard } from "../components";

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
    <s-page size="large" className="page-shell">
      <s-heading slot="title" size="large">{t('settings.title')}</s-heading>

      <div className="admin-stack">
        <section className="metric-grid">
          <SummaryCard
            title={t("settingsAdmin.currentThreshold")}
            value={`${value}%`}
            badge={<s-badge tone="info">{t("settingsAdmin.storeSetting")}</s-badge>}
            description={t("settingsAdmin.currentThresholdDescription")}
          />
          <SummaryCard
            title={t("settingsAdmin.environmentDefault")}
            value={`${envDefault}%`}
            badge={<s-badge tone="warning">{t("settingsAdmin.fallback")}</s-badge>}
            description={t("settingsAdmin.environmentDefaultDescription")}
          />
        </section>

        <section className="admin-section-grid admin-section-grid--wide">
          <div className="admin-card">
            <div className="admin-card__header">
              <div>
                <p className="admin-eyebrow">{t("settingsAdmin.matchingStrictness")}</p>
                <h2 className="admin-card__title">{t('settings.threshold.title')}</h2>
                <p className="admin-card__description">{t('settings.threshold.description')}</p>
              </div>
            </div>

            <div className="admin-note">
              <strong>{t('settings.threshold.howItWorks')}</strong>
              <span>{t("settingsAdmin.strictnessHint")}</span>
            </div>

            <Form method="post">
              <div className="admin-form-block">
                <s-number-field
                  label={t('settings.threshold.label')}
                  name="similarityThreshold"
                  min="0"
                  max="100"
                  value={value}
                  onChange={(e: any) => setValue(e.currentTarget.value)}
                />

                <div className="admin-actions">
                  <s-button type="submit" variant="primary" loading={isSubmitting || undefined}>
                    {t('settings.threshold.save')}
                  </s-button>
                  <s-button type="button" variant="secondary" onClick={() => setValue(envDefault.toString())}>
                    {t('settings.threshold.resetToDefault')}
                  </s-button>
                </div>
              </div>
            </Form>
          </div>

          <div className="admin-card">
            <div className="admin-card__header">
              <div>
                <p className="admin-eyebrow">{t("settingsAdmin.guidance")}</p>
                <h2 className="admin-card__title">{t("settingsAdmin.recommendedSetup")}</h2>
              </div>
            </div>

            <div className="admin-guidance-list">
              <div className="admin-guidance-item">
                <strong>{t("settingsAdmin.guidanceItems.broadTitle")}</strong>
                <p>{t("settingsAdmin.guidanceItems.broadDescription")}</p>
              </div>
              <div className="admin-guidance-item">
                <strong>{t("settingsAdmin.guidanceItems.balancedTitle")}</strong>
                <p>{t("settingsAdmin.guidanceItems.balancedDescription")}</p>
              </div>
              <div className="admin-guidance-item">
                <strong>{t("settingsAdmin.guidanceItems.strictTitle")}</strong>
                <p>{t("settingsAdmin.guidanceItems.strictDescription")}</p>
              </div>
            </div>
          </div>
        </section>

        <section className="admin-card">
          <div className="admin-card__header">
            <div>
              <h2 className="admin-card__title">{t('common.language')}</h2>
            </div>
          </div>
          <div className="admin-form-block">
            <LanguageSwitcher />
          </div>
        </section>
      </div>
    </s-page>
  );
}
