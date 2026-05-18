import { useTranslation } from "react-i18next";

interface StatusBadgeProps {
  status: string;
}

const STATUS_CONFIG: Record<string, { tone: "critical" | "warning" | "success" | undefined; labelKey: string }> = {
  active: { tone: "critical", labelKey: "status.needsReview" },
  dismissed: { tone: "warning", labelKey: "status.dismissed" },
  resolved: { tone: "success", labelKey: "status.resolved" },
};

export function StatusBadge({ status }: StatusBadgeProps) {
  const { t } = useTranslation();
  const normalized = status?.toLowerCase() ?? '';
  const config = STATUS_CONFIG[normalized];

  return (
    <s-badge tone={config?.tone}>
      {config ? t(config.labelKey) : status || t("common.unknown")}
    </s-badge>
  );
}
