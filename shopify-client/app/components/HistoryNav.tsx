import { useTranslation } from "react-i18next";

export type HistorySection = "scans" | "decisions" | "report";

export function HistoryNav({ active }: { active: HistorySection }) {
  const { t } = useTranslation();
  return (
    <nav className="history-nav" aria-label={t("redesign.scanHistory")}>
      <s-button-group>
        <s-button
          variant={active === "scans" ? "primary" : "secondary"}
          href="/app/evidence?view=scans"
        >
          {t("redesign.scans")}
        </s-button>
        <s-button
          variant={active === "decisions" ? "primary" : "secondary"}
          href="/app/evidence"
        >
          {t("workspace.history")}
        </s-button>
        <s-button
          variant={active === "report" ? "primary" : "secondary"}
          href="/app/audit-report"
        >
          {t("workspace.reportTitle")}
        </s-button>
      </s-button-group>
    </nav>
  );
}
