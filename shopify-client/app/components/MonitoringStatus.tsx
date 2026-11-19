import { useTranslation } from "react-i18next";
import { LocalDateTime } from "./LocalDateTime";
import type { monitoringState } from "../services/monitoring-state";

export function MonitoringStatus({
  state,
  lastSuccess,
}: {
  state: ReturnType<typeof monitoringState>;
  lastSuccess: string | null;
}) {
  const { t, i18n } = useTranslation();
  const monitorNeedsAction = state === "failed" || state === "delayed";

  return (
    <section className="settings-overview__panel">
      <h2>{t("workspace.monitoringLabel")}</h2>
      <s-badge tone={state === "enabled" ? "success" : state === "processing" ? "info" : "warning"}>
        {t(`catalogOverview.monitoring.${state}`)}
      </s-badge>
      <p className="admin-helper">
        {lastSuccess ? (
          <>
            {t("workspace.lastSuccess")}{" "}
            <LocalDateTime value={lastSuccess} locale={i18n.language} />
          </>
        ) : t("workspace.neverRun")}
      </p>
      {monitorNeedsAction && (
        <s-link href="/app/manual-check">{t("dashboard.admin.status.noActionNeeded.action")}</s-link>
      )}
    </section>
  );
}
