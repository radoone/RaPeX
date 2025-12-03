import { useTranslation } from "react-i18next";

export function SafetyGatePortal() {
  const { t } = useTranslation();

  return (
    <s-section heading={t('portal.title')}>
      <s-text>
        {t('portal.description')}
      </s-text>
      <s-stack direction="inline" gap="small" wrap>
        <s-button
          variant="primary"
          href="https://ec.europa.eu/safety-gate-alerts/screen/search?resetSearch=true"
          target="_blank"
        >
          {t('portal.searchDatabase')}
        </s-button>
        <s-button
          variant="secondary"
          href="https://ec.europa.eu/safety-gate-alerts/screen/home"
          target="_blank"
        >
          {t('portal.home')}
        </s-button>
      </s-stack>
    </s-section>
  );
}
