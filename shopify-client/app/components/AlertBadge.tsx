interface AlertBadgeProps {
  alertLevel?: string;
  alertType?: string;
  riskDescription?: string;
  showSeverity?: boolean;
}

export function cleanSeverityLabel(value?: string | null): string {
  if (!value) return "Safety alert";
  const normalized = value.toLowerCase();
  if (normalized.includes("serious")) return "Serious risk";
  if (normalized.includes("high")) return "High risk";
  if (normalized.includes("medium")) return "Medium risk";
  if (normalized.includes("low")) return "Low risk";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function AlertBadge({ alertLevel, alertType, riskDescription, showSeverity = false }: AlertBadgeProps) {
  const tone = getAlertTone(alertLevel);

  if (showSeverity) {
    return (
      <s-badge tone={tone} title={riskDescription || undefined}>
        {cleanSeverityLabel(alertLevel)}
      </s-badge>
    );
  }

  let displayText = cleanRiskLabel(alertType || alertLevel || 'Unknown');

  if (!alertType && alertLevel && alertLevel !== 'Unknown') {
    const normalized = alertLevel.toLowerCase();
    if (normalized.includes('chemical')) {
      displayText = 'Chemical';
    } else if (normalized.includes('injuries')) {
      displayText = 'Injuries';
    } else if (normalized.includes('fire')) {
      displayText = 'Fire';
    } else if (normalized.includes('electric')) {
      displayText = 'Electric shock';
    } else {
      displayText = cleanRiskLabel(alertLevel);
    }
  }

  return (
    <s-badge tone={tone} title={riskDescription || undefined}>
      {displayText}
    </s-badge>
  );
}

export function cleanRiskLabel(value?: string | null): string {
  const cleaned = (value || 'Unknown')
    .replace(/\s*\/\s*other\b/gi, '')
    .replace(/\bother risk\b/gi, 'Safety risk')
    .trim();

  return cleaned || 'Safety risk';
}

function getAlertTone(alertLevel?: string): "critical" | "warning" | "success" | "info" | undefined {
  if (!alertLevel) return "warning";

  const normalized = alertLevel.toLowerCase();
  if (normalized.includes('serious')) return "critical";
  if (normalized.includes('high') || normalized.includes('other risk')) return "warning";
  if (normalized.includes('low')) return "success";
  return "info";
}
