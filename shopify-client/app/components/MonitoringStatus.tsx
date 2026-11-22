import { useTranslation } from "react-i18next";
import { LocalDateTime } from "./LocalDateTime";
import { monitoringTimeZone } from "../services/monitoring-schedule";
import type { monitoringState } from "../services/monitoring-state";

export function NextMonitoringCheck({ value }: { value: string }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === "en" ? "en-GB" : i18n.language;
  return (
    <>
      {t("dashboard.admin.nextAutomaticCheck")} <strong>
        <LocalDateTime
          value={value}
          locale={locale}
          timeZone={monitoringTimeZone}
          format={(date) => new Intl.DateTimeFormat(locale, {
            timeZone: monitoringTimeZone,
            day: "numeric",
            month: "numeric",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            timeZoneName: "short",
          }).format(date)}
        />
      </strong>
    </>
  );
}

export function MonitoringStatus({
  state,
  lastSuccess,
  nextCheck,
  initialAuditCompleted,
}: {
  state: ReturnType<typeof monitoringState>;
  lastSuccess: string | null;
  nextCheck: string | null;
  initialAuditCompleted: boolean;
}) {
  const { t, i18n } = useTranslation();
  const monitorNeedsAction = state === "failed" || state === "delayed";
  const completedCheckFormat = new Intl.DateTimeFormat(i18n.language, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: monitoringTimeZone,
  });

  return (
    <section className="settings-overview__panel">
      <h2>{t("workspace.monitoringLabel")}</h2>
      <s-badge tone={state === "enabled" ? "success" : state === "processing" || state === "starting" ? "info" : "warning"}>
        {t(state === "enabled" ? "settingsOverview.on" : `catalogOverview.monitoring.${state}`)}
      </s-badge>
      <p className="admin-helper">
        {lastSuccess ? (
          <>
            {t("workspace.lastSuccess")}{" "}
            <LocalDateTime value={lastSuccess} locale={i18n.language} format={completedCheckFormat.format} />
          </>
        ) : t("workspace.neverRun")}
      </p>
      {initialAuditCompleted && <p className="admin-helper">{t("catalogOverview.firstResultTitle")}</p>}
      {nextCheck && <p className="admin-helper"><NextMonitoringCheck value={nextCheck} /></p>}
      {monitorNeedsAction && (
        <s-link href="/app/manual-check">{t("dashboard.admin.status.noActionNeeded.action")}</s-link>
      )}
    </section>
  );
}
