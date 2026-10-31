import { AdminCard } from "./AdminCard";
import { useTranslation } from "react-i18next";
import { useState } from "react";
import { useLocation, useRevalidator } from "react-router";
import { LocalDateTime, useHydrated } from "./LocalDateTime";
import { monitoringState } from "../services/monitoring-state";

export function MonitoringStatus({
  billing,
  status,
  lastSuccess,
}: {
  billing: Parameters<typeof monitoringState>[0] & {
    pricingPlansUrl?: string | null;
  };
  status?: string | null;
  lastSuccess?: string | null;
}) {
  const { t, i18n } = useTranslation();
  const revalidator = useRevalidator();
  const { pathname } = useLocation();
  const hydrated = useHydrated();
  const [observedAt] = useState(() => Date.now());
  const state = monitoringState(
    billing,
    status,
    observedAt,
    hydrated ? lastSuccess : undefined,
  );
  const help =
    state === "preview"
      ? t("experience.previewHelp")
      : state === "paused"
        ? t("experience.pausedHelp")
        : state === "unverified"
          ? t("billing.verificationError")
          : state === "unknown"
            ? t("workspace.monitoringUnknownHelp")
          : t("workspace.scheduleHelp");
  const needsPlan = state === "paused";
  return (
    <AdminCard
      className={`admin-card monitoring-status monitoring-status--${state}`}
      aria-label={t("workspace.monitoringLabel")}
    >
      <div className="monitoring-status__main">
        <h2 className="admin-card__title">{t("workspace.monitoringLabel")}</h2>
        <p role="status">
          <s-badge
            tone={
              state === "enabled"
                ? "success"
                : state === "processing"
                  ? "info"
                  : "warning"
            }
          >
            {state === "delayed"
              ? t("experience.delayed")
              : t(`workspace.monitoring.${state}`)}
          </s-badge>
        </p>
        <p className="admin-helper">{help}</p>
        {(pathname !== "/app/settings" ||
          (needsPlan && billing.pricingPlansUrl) ||
          ["unverified", "unknown", "failed", "delayed"].includes(state)) && (
          <div className="admin-actions">
            {needsPlan && billing.pricingPlansUrl && (
              <s-button
                variant="primary"
                onClick={() => window.open(billing.pricingPlansUrl!, "_top")}
              >
                {t("billingRedirect.openPricingPlans")}
              </s-button>
            )}
            {["unverified", "unknown"].includes(state) && (
              <s-button
                variant="secondary"
                loading={revalidator.state !== "idle"}
                onClick={() => revalidator.revalidate()}
              >
                {t("actions.retry")}
              </s-button>
            )}
            {["failed", "delayed"].includes(state) && (
              <s-button variant="secondary" href="/app/manual-check">
                {t("dashboard.admin.status.monitoringProblem.action")}
              </s-button>
            )}
            {pathname !== "/app/settings" && (
              <s-button variant="tertiary" href="/app/settings">
                {t("settings.title")}
              </s-button>
            )}
          </div>
        )}
      </div>
      {lastSuccess !== undefined && (
        <div className="monitoring-status__last">
          <span className="admin-helper">{t("workspace.lastSuccess")}</span>
          <p>
            {lastSuccess ? (
              <LocalDateTime
                value={lastSuccess}
                locale={i18n.language === "en" ? "en-GB" : i18n.language}
              />
            ) : (
              t("workspace.neverRun")
            )}
          </p>
        </div>
      )}
    </AdminCard>
  );
}
