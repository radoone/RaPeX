import { useState } from "react";
import { useTranslation } from "react-i18next";

export interface OnboardingWizardProps {
  stats: {
    totalProducts: number;
  };
  isSubmitting: boolean;
  onScanCatalog: () => void;
  scanResults?: {
    success: boolean;
    message?: string;
    results?: {
      processed: number;
      alertsCreated: number;
    };
  };
  onComplete: (payload: {
    similarityThreshold: number;
    autoDraftHighRisk: boolean;
    emailNotifications: boolean;
    slackWebhookUrl: string;
  }) => void;
}

export function OnboardingWizard({
  stats,
  isSubmitting,
  onScanCatalog,
  scanResults,
  onComplete
}: OnboardingWizardProps) {
  const { t } = useTranslation();
  const [currentStep, setCurrentStep] = useState(1);
  const [threshold, setThreshold] = useState(70);
  const [autoDraft, setAutoDraft] = useState(false);
  const [emailNotify, setEmailNotify] = useState(false);
  const [slackUrl, setSlackUrl] = useState("");

  const calibration = (() => {
    if (threshold < 60) {
      return {
        type: "broad" as const,
        title: t("onboarding.steps.sensitivity.calibration.broadTitle"),
        desc: t("onboarding.steps.sensitivity.calibration.broadDesc")
      };
    } else if (threshold <= 75) {
      return {
        type: "balanced" as const,
        title: t("onboarding.steps.sensitivity.calibration.balancedTitle"),
        desc: t("onboarding.steps.sensitivity.calibration.balancedDesc")
      };
    } else {
      return {
        type: "strict" as const,
        title: t("onboarding.steps.sensitivity.calibration.strictTitle"),
        desc: t("onboarding.steps.sensitivity.calibration.strictDesc")
      };
    }
  })();

  const finishOnboarding = () => {
    onComplete({
      similarityThreshold: threshold,
      autoDraftHighRisk: autoDraft,
      emailNotifications: emailNotify,
      slackWebhookUrl: slackUrl
    });
  };

  const getStepClass = (stepNum: number) => {
    if (currentStep === stepNum) return "onboarding-stepper__step onboarding-stepper__step--active";
    if (currentStep > stepNum) return "onboarding-stepper__step onboarding-stepper__step--completed";
    return "onboarding-stepper__step";
  };

  const progressLineStyle = {
    width: `${(currentStep - 1) * 50}%`
  };

  return (
    <s-page size="narrow" suppressHydrationWarning>
      <div className="onboarding-wizard" style={{ marginTop: "24px" }}>
        {/* HEADER SECTION WITH STEPPER TIMELINE */}
        <div className="onboarding-wizard__header">
          <s-stack gap="small">
            <s-heading size="large" suppressHydrationWarning>{t("onboarding.title")}</s-heading>
            <s-text tone="subdued">{t("onboarding.subtitle")}</s-text>
          </s-stack>

          <div className="onboarding-stepper">
            <div className="onboarding-stepper__progress-line" style={progressLineStyle} />
            
            <div className={getStepClass(1)} onClick={() => setCurrentStep(1)}>
              <div className="onboarding-stepper__circle">
                {currentStep > 1 ? "✓" : "1"}
              </div>
              <div className="onboarding-stepper__label">
                {t("onboarding.steps.sensitivity.label")}
              </div>
            </div>

            <div className={getStepClass(2)} onClick={() => currentStep >= 2 ? setCurrentStep(2) : undefined}>
              <div className="onboarding-stepper__circle">
                {currentStep > 2 ? "✓" : "2"}
              </div>
              <div className="onboarding-stepper__label">
                {t("onboarding.steps.scan.label")}
              </div>
            </div>

            <div className={getStepClass(3)} onClick={() => currentStep >= 3 ? setCurrentStep(3) : undefined}>
              <div className="onboarding-stepper__circle">3</div>
              <div className="onboarding-stepper__label">
                {t("onboarding.steps.automation.label")}
              </div>
            </div>
          </div>
        </div>

        {/* STEP BODY */}
        <div className="onboarding-wizard__body">
          {/* STEP 1: SENSITIVITY CALIBRATION */}
          {currentStep === 1 && (
            <s-stack gap="large">
              <s-stack gap="small">
                <s-heading size="medium">{t("onboarding.steps.sensitivity.title")}</s-heading>
                <s-text tone="subdued">{t("onboarding.steps.sensitivity.description")}</s-text>
              </s-stack>

              <s-box padding="large" background="bg-surface-secondary" borderRadius="large">
                <s-stack gap="large">
                  <s-text fontWeight="bold" size="large">
                    {t("onboarding.steps.sensitivity.thresholdLabel", { value: threshold })}
                  </s-text>
                  <input
                    type="range"
                    min="40"
                    max="90"
                    step="5"
                    value={threshold}
                    onChange={(e) => setThreshold(Number(e.target.value))}
                    style={{
                      width: "100%",
                      accentColor: "var(--s-color-primary)",
                      height: "6px",
                      borderRadius: "3px",
                      cursor: "pointer"
                    }}
                  />
                  <s-stack direction="inline" align="space-between">
                    <s-text size="small" tone="subdued">{t("onboarding.steps.sensitivity.broad")}</s-text>
                    <s-text size="small" tone="subdued">{t("onboarding.steps.sensitivity.balanced")}</s-text>
                    <s-text size="small" tone="subdued">{t("onboarding.steps.sensitivity.strict")}</s-text>
                  </s-stack>
                </s-stack>
              </s-box>

              {/* DYNAMIC CALIBRATION EXPLANATION CARD */}
              <div className={`onboarding-calibration-card onboarding-calibration-card--${calibration.type}`}>
                <s-stack gap="small">
                  <s-text fontWeight="bold" tone={calibration.type === "broad" ? "caution" : calibration.type === "strict" ? "info" : "success"}>
                    ⚡ {calibration.title}
                  </s-text>
                  <s-text size="small" tone="subdued">
                    {calibration.desc}
                  </s-text>
                </s-stack>
              </div>

              <s-stack direction="inline" align="space-between" style={{ marginTop: "16px" }}>
                <div />
                <s-button variant="primary" onClick={() => setCurrentStep(2)}>
                  {t("onboarding.nextStep")}
                </s-button>
              </s-stack>
            </s-stack>
          )}

          {/* STEP 2: CATALOG SCAN */}
          {currentStep === 2 && (
            <s-stack gap="large">
              <s-stack gap="small">
                <s-heading size="medium">{t("onboarding.steps.scan.title")}</s-heading>
                <s-text tone="subdued">{t("onboarding.steps.scan.description")}</s-text>
              </s-stack>

              <s-box padding="large" background="bg-surface-secondary" borderRadius="large">
                <s-stack gap="base" align="center">
                  <s-text size="large" fontWeight="bold">
                    {t("onboarding.steps.scan.toScan", { count: stats.totalProducts })}
                  </s-text>

                  {isSubmitting ? (
                    <s-stack gap="base" align="center" style={{ margin: "20px 0" }}>
                      <s-spinner size="large" />
                      <s-text>{t("onboarding.steps.scan.scanning")}</s-text>
                    </s-stack>
                  ) : scanResults?.success && scanResults.results ? (
                    <div style={{ width: "100%", marginTop: "12px" }}>
                      <s-banner tone="success" heading={t("onboarding.steps.scan.complete")}>
                        <s-stack gap="small" style={{ marginTop: "8px" }}>
                          <s-text>• {t("onboarding.steps.scan.scanned", { count: scanResults.results.processed })}</s-text>
                          <s-text>• {t("onboarding.steps.scan.alerts", { count: scanResults.results.alertsCreated })}</s-text>
                        </s-stack>
                      </s-banner>
                    </div>
                  ) : (
                    <div style={{ margin: "16px 0" }}>
                      <s-button variant="primary" onClick={onScanCatalog}>
                        {t("onboarding.steps.scan.startButton")}
                      </s-button>
                    </div>
                  )}
                </s-stack>
              </s-box>

              <s-stack direction="inline" align="space-between" style={{ marginTop: "16px" }}>
                <s-button variant="secondary" onClick={() => setCurrentStep(1)}>
                  {t("onboarding.back")}
                </s-button>
                <s-button variant="primary" onClick={() => setCurrentStep(3)}>
                  {t("onboarding.nextStep")}
                </s-button>
              </s-stack>
            </s-stack>
          )}

          {/* STEP 3: AUTOMATION & NOTIFICATIONS */}
          {currentStep === 3 && (
            <s-stack gap="large">
              <s-stack gap="small">
                <s-heading size="medium">{t("onboarding.steps.automation.title")}</s-heading>
                <s-text tone="subdued">{t("onboarding.steps.automation.description")}</s-text>
              </s-stack>

              <s-box padding="large" background="bg-surface-secondary" borderRadius="large">
                <s-stack gap="large">
                  {/* Webhooks Info (Static Active) */}
                  <s-stack gap="small-100">
                    <s-text fontWeight="bold">{t("onboarding.steps.automation.webhooks.title")}</s-text>
                    <s-text tone="subdued" size="small">
                      {t("onboarding.steps.automation.webhooks.desc")}
                    </s-text>
                  </s-stack>

                  {/* Auto-Draft Toggle (Premium Styled Switch) */}
                  <s-stack gap="small-100">
                    <s-text fontWeight="bold">{t("onboarding.steps.automation.quarantine.title")}</s-text>
                    <s-text tone="subdued" size="small" style={{ marginBottom: "8px" }}>
                      {t("onboarding.steps.automation.quarantine.desc")}
                    </s-text>
                    <div>
                      <label className="onboarding-switch">
                        <input
                          type="checkbox"
                          className="onboarding-switch__input"
                          checked={autoDraft}
                          onChange={(e) => setAutoDraft(e.target.checked)}
                        />
                        <div className="onboarding-switch__track">
                          <div className="onboarding-switch__thumb" />
                        </div>
                        <s-text size="small">{t("onboarding.steps.automation.quarantine.label")}</s-text>
                      </label>
                    </div>
                  </s-stack>

                  {/* Email Alert Toggle (Premium Styled Switch) */}
                  <s-stack gap="small-100">
                    <s-text fontWeight="bold">{t("onboarding.steps.automation.notify.title")}</s-text>
                    <div style={{ marginTop: "6px" }}>
                      <label className="onboarding-switch">
                        <input
                          type="checkbox"
                          className="onboarding-switch__input"
                          checked={emailNotify}
                          onChange={(e) => setEmailNotify(e.target.checked)}
                        />
                        <div className="onboarding-switch__track">
                          <div className="onboarding-switch__thumb" />
                        </div>
                        <s-text size="small">{t("onboarding.steps.automation.notify.label")}</s-text>
                      </label>
                    </div>
                  </s-stack>

                  {/* Slack URL Field */}
                  <s-stack gap="small-100">
                    <s-text fontWeight="bold">{t("onboarding.steps.automation.slack.title")}</s-text>
                    <s-text tone="subdued" size="small">
                      {t("onboarding.steps.automation.slack.desc")}
                    </s-text>
                    <input
                      type="text"
                      placeholder={t("onboarding.steps.automation.slack.placeholder")}
                      value={slackUrl}
                      onChange={(e) => setSlackUrl(e.target.value)}
                      style={{
                        width: "100%",
                        padding: "10px 14px",
                        borderRadius: "8px",
                        border: "1px solid var(--border)",
                        marginTop: "8px",
                        fontSize: "14px",
                        background: "var(--surface)",
                        color: "var(--text)"
                      }}
                    />
                  </s-stack>
                </s-stack>
              </s-box>

              <s-stack direction="inline" align="space-between" style={{ marginTop: "16px" }}>
                <s-button variant="secondary" onClick={() => setCurrentStep(2)}>
                  {t("onboarding.back")}
                </s-button>
                <s-button
                  variant="primary"
                  loading={isSubmitting || undefined}
                  onClick={finishOnboarding}
                >
                  {t("onboarding.finishButton")}
                </s-button>
              </s-stack>
            </s-stack>
          )}
        </div>
      </div>
    </s-page>
  );
}
