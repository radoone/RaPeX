interface StatusBadgeProps {
  status: string;
}

const STATUS_CONFIG: Record<string, { tone: "critical" | "warning" | "success" | undefined; label: string }> = {
  active: { tone: "critical", label: "Active" },
  dismissed: { tone: "warning", label: "Dismissed" },
  resolved: { tone: "success", label: "Resolved" },
};

export function StatusBadge({ status }: StatusBadgeProps) {
  const normalized = status?.toLowerCase() ?? '';
  const config = STATUS_CONFIG[normalized] || { tone: undefined, label: status || 'Unknown' };

  return <s-badge tone={config.tone}>{config.label}</s-badge>;
}
