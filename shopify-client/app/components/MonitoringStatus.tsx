import { useTranslation } from "react-i18next";
import { LocalDateTime } from "./LocalDateTime";
import { monitoringState } from "../services/monitoring-state";
export function MonitoringStatus({
  billing,
  status,
  lastSuccess,
}: {
  billing: Parameters<typeof monitoringState>[0];
  status?: string | null;
  lastSuccess?: string | null;
}) {
  const { t, i18n } = useTranslation();
  const state = monitoringState(billing, status);
  return (
    <section
      className="admin-card monitoring-status"
      aria-label={t("workspace.monitoringLabel")}
    >
      <div>
        <h2 className="admin-card__title">{t("workspace.monitoringLabel")}</h2>
        <p role="status">{t(`workspace.monitoring.${state}`)}</p>
        {state === "enabled" && (
          <p className="admin-helper">{t("workspace.scheduleHelp")}</p>
        )}
      </div>
      {lastSuccess !== undefined && (
        <div>
          <span className="admin-helper">{t("workspace.lastSuccess")}</span>
          <p>
            {lastSuccess
              ? <LocalDateTime value={lastSuccess} locale={i18n.language} />
              : t("workspace.neverRun")}
          </p>
        </div>
      )}
    </section>
  );
}
